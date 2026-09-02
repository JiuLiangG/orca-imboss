import { Cron } from "croner";
import type { CronJob } from "../../shared/types";
import * as cronService from "../db/services/cron";
import type { CronJobInput } from "../db/services/cron";
import { deliver } from "../agent/session-queue";

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
    for (const job of cronService.listEnabledJobs()) {
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
  const job = cronService.upsertJob(input); // validates schedule + id.
  registerJob(job);
  return job;
}

/** Delete a job (DB + Cron handle). Returns false when the job does not exist. */
export function removeJob(id: string): boolean {
  stopJob(id);
  return cronService.deleteJob(id);
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
      cronService.markRun(job.id, Math.floor(Date.now() / 1000));
    } catch (err) {
      console.error(
        `[cron] markRun for ${job.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
    // Serialized via the session queue; the reply is auto-persisted as the
    // job's employee (which also bumps the chat's unread counter).
    void deliver(job.employeeId, job.chatId, job.content, {
      persistReplyAs: job.employeeId,
    });
  });
  // Keep the stored `next_run_at` fresh (valuable after an app restart when
  // the persisted value may be stale).
  try {
    const next = cron.nextRun();
    cronService.setNextRun(
      job.id,
      next ? Math.floor(next.getTime() / 1000) : null,
    );
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
