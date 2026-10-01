import type { CronJob, CronJobInput } from "@shared/types";
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
