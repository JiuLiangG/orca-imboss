import type { CronJob, CronJobInput, ParsedCronJobId } from "@shared/types";
import { Cron } from "croner";
import { wakeAgent } from "./agent/session-queue";
import * as dbCron from "./db/cron";

/**
 * In-process cron scheduler.
 *
 * Holds a live `Cron` handle per job id and drives startup re-registration of
 * persisted jobs plus set/remove operations. Jobs only run while the Electron
 * app is alive — this is NOT an OS-level background schedule (documented
 * limitation).
 */

const jobs = new Map<string, Cron>();

/** Re-register persisted enabled jobs at startup (best-effort). */
export function initCron(): void {
  try {
    for (const job of dbCron.listEnabledJobs()) {
      registerJob(job);
    }
  } catch (err) {
    console.error(
      "[cron] init failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Create or update a job: validate + persist, then (re)register the Cron
 * handle. Validation (bad schedule, unknown chat/employee) throws.
 */
export function setJob(input: CronJobInput): CronJob {
  const job = dbCron.upsertJob(input); // validates schedule + id.
  registerJob(job);
  return job;
}

/** Delete a job (DB + Cron handle). Returns false when the job does not exist. */
export function removeJob(id: string): boolean {
  stopJob(id);
  return dbCron.deleteJob(id);
}

/**
 * Stop every live Cron handle whose job belongs to one of the given chats.
 *
 * The `cron_jobs.chat_id` FK cascade removes the rows when the chats are
 * deleted, but it does NOT touch these in-process handles. Call this BEFORE
 * deleting the chats so no job fires into a chat that is being torn down.
 * Scans the in-memory registry, so it is independent of whether the DB rows
 * still exist. Returns the number of handles stopped.
 */
export function stopJobsForChats(chatIds: number[]): number {
  const targets = new Set(chatIds);
  if (targets.size === 0) return 0;
  return stopJobsMatching((parsed) => targets.has(parsed.chatId));
}

/**
 * Stop every live Cron handle owned by an employee. Used when an employee row
 * is hard-deleted (the `cron_jobs.employee_id` FK cascade removes the rows but
 * leaves the live handles running). Returns the number stopped.
 */
export function stopJobsForEmployee(employeeId: number): number {
  return stopJobsMatching((parsed) => parsed.employeeId === employeeId);
}

/** Stop and forget every live handle matching the predicate (best-effort). */
function stopJobsMatching(
  predicate: (parsed: ParsedCronJobId) => boolean,
): number {
  let stopped = 0;
  // Snapshot the keys: `stopJob` mutates the Map during iteration.
  for (const id of [...jobs.keys()]) {
    let parsed: ParsedCronJobId;
    try {
      parsed = dbCron.parseCronJobId(id);
    } catch {
      continue; // Defensive: an unparseable key has no manageable handle.
    }
    if (!predicate(parsed)) continue;
    stopJob(id);
    stopped += 1;
  }
  return stopped;
}

/** Stop every live Cron handle (best-effort on app quit). */
export function stopAll(): void {
  for (const [, cron] of jobs) {
    try {
      cron.stop();
    } catch {
      // Best-effort.
    }
  }
  jobs.clear();
}

function registerJob(job: CronJob): void {
  stopJob(job.id);
  const cron = new Cron(job.schedule, {}, () => {
    try {
      dbCron.markRun(job.id, Math.floor(Date.now() / 1000));
    } catch (err) {
      console.error(
        `[cron] markRun for ${job.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
    // Serialized via the session queue. The agent posts its own output via
    // `imb_send_message` (no reply is auto-persisted). `wakeAgent` redirects
    // the assistant (id 0) from a task group chat to its root-chat session.
    void wakeAgent(job.employeeId, job.chatId, job.content);
  });
  // Keep the stored `next_run_at` fresh (valuable after an app restart when
  // the persisted value may be stale).
  try {
    const next = cron.nextRun();
    dbCron.setNextRun(job.id, next ? Math.floor(next.getTime() / 1000) : null);
  } catch {
    // next_run_at is informational; never block re-registration on it.
  }
  jobs.set(job.id, cron);
}

function stopJob(id: string): void {
  const existing = jobs.get(id);
  if (existing) {
    try {
      existing.stop();
    } catch {
      // Best-effort.
    }
    jobs.delete(id);
  }
}
