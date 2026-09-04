import type { CronJob, CronJobInput } from "@shared/types";
import { Cron } from "croner";
import { getDB } from "../index";

interface ParsedCronJobId {
  chatId: number;
  employeeId: number;
  jobId: string;
}

interface CronJobRow {
  id: string;
  chat_id: number;
  employee_id: number;
  schedule: string;
  content: string;
  enabled: number;
  created_at: number;
  last_run_at: number | null;
  next_run_at: number | null;
}

export function listEnabledJobs(): CronJob[] {
  return (
    getDB()
      .prepare(
        `SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY created_at ASC, id ASC`,
      )
      .all() as CronJobRow[]
  ).map(toCronJob);
}

export function getJob(id: string): CronJob | null {
  const row = getDB()
    .prepare(`SELECT * FROM cron_jobs WHERE id = ?`)
    .get(id) as CronJobRow | undefined;
  return row ? toCronJob(row) : null;
}

/** Parse + validate a composite cron job id `"chatId/employeeId/jobId"`. */
export function parseCronJobId(id: string): ParsedCronJobId {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Cron job id must be a non-empty string.");
  }
  const parts = id.split("/");
  if (parts.length !== 3) {
    throw new Error('Cron job id must be "chatId/employeeId/jobId".');
  }
  const [chatIdStr, employeeIdStr, jobId] = parts;
  const chatId = Number(chatIdStr);
  const employeeId = Number(employeeIdStr);
  if (!Number.isSafeInteger(chatId) || chatId <= 0) {
    throw new Error("Cron job id has an invalid chatId.");
  }
  if (!Number.isSafeInteger(employeeId) || employeeId < 0) {
    throw new Error("Cron job id has an invalid employeeId.");
  }
  if (jobId.trim().length === 0) {
    throw new Error("Cron job id has an empty jobId.");
  }
  return { chatId, employeeId, jobId };
}

/**
 * Create or update a cron job. The `id` is parsed to verify it matches the
 * supplied chat/employee; the schedule is validated by croner (throws on an
 * invalid expression) and normalized to 6-field before storage.
 */
export function upsertJob(input: CronJobInput): CronJob {
  const parsed = parseCronJobId(input.id);
  if (
    parsed.chatId !== input.chatId ||
    parsed.employeeId !== input.employeeId
  ) {
    throw new Error("Cron job id does not match its chat/employee.");
  }
  const schedule = normalizeSchedule(input.schedule);
  const nextRun = nextRunForSchedule(input.schedule);
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  const existing = getJob(input.id);
  const createdAt = existing ? existing.createdAt : now;
  const lastRunAt = existing ? existing.lastRunAt : null;
  // Foreign keys (ON) reject a missing chat/employee.
  db.prepare(
    `INSERT INTO cron_jobs (id, chat_id, employee_id, schedule, content, enabled, created_at, last_run_at, next_run_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       chat_id = excluded.chat_id,
       employee_id = excluded.employee_id,
       schedule = excluded.schedule,
       content = excluded.content,
       next_run_at = excluded.next_run_at`,
  ).run(
    input.id,
    input.chatId,
    input.employeeId,
    schedule,
    input.content,
    createdAt,
    lastRunAt,
    nextRun,
  );
  return getJob(input.id) as CronJob;
}

export function deleteJob(id: string): boolean {
  return (
    getDB().prepare("DELETE FROM cron_jobs WHERE id = ?").run(id).changes > 0
  );
}

/** Record a run and recompute the next run time from the stored schedule. */
export function markRun(id: string, at: number): void {
  const row = getDB()
    .prepare(`SELECT * FROM cron_jobs WHERE id = ?`)
    .get(id) as CronJobRow | undefined;
  if (!row) return;
  let nextRun: number | null;
  try {
    nextRun = nextRunForSchedule(row.schedule);
  } catch {
    nextRun = row.next_run_at; // schedule no longer parseable — keep last value.
  }
  getDB()
    .prepare(
      "UPDATE cron_jobs SET last_run_at = ?, next_run_at = ? WHERE id = ?",
    )
    .run(at, nextRun, id);
}

/** Overwrite a job's next run time (used on (re)registration). */
export function setNextRun(id: string, at: number | null): void {
  getDB()
    .prepare("UPDATE cron_jobs SET next_run_at = ? WHERE id = ?")
    .run(at, id);
}

function toCronJob(row: CronJobRow): CronJob {
  return {
    id: row.id,
    chatId: row.chat_id,
    employeeId: row.employee_id,
    schedule: row.schedule,
    content: row.content,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
  };
}

/**
 * Normalize a 5-field cron expression to 6-field by prefixing an implicit
 * `0` seconds field, and validate the field count. Croner is otherwise used
 * as-is (6-field, seconds included).
 */
function normalizeSchedule(schedule: string): string {
  const trimmed = (schedule ?? "").trim();
  if (trimmed.length === 0) throw new Error("Cron schedule must not be empty.");
  const parts = trimmed.split(/\s+/);
  if (parts.length < 5) {
    throw new Error(
      "Cron schedule must have at least 5 fields (seconds optional).",
    );
  }
  if (parts.length === 5) return `0 ${trimmed}`;
  if (parts.length === 6 || parts.length === 7) return trimmed;
  throw new Error("Cron schedule must have 5, 6, or 7 fields.");
}

/**
 * Compute the next run time (epoch seconds) for a schedule, or `null` when
 * the schedule can never fire again. Also validates the expression by parsing
 * it with croner (throws on invalid patterns).
 */
function nextRunForSchedule(schedule: string): number | null {
  const cron = new Cron(normalizeSchedule(schedule), { mode: "auto" });
  const next = cron.nextRun();
  return next ? Math.floor(next.getTime() / 1000) : null;
}
