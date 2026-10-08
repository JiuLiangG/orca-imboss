/**
 * Row of the `cron_jobs` table. `id` is the composite
 * `"{chatId}/{employeeId}/{jobId}"`. Jobs only run while the app is alive
 * (Electron main process — no background OS scheduler).
 */
export interface CronJob {
  id: string;
  chatId: number;
  employeeId: number;
  /** 6-field cron expression (seconds included); 5-field is normalized to `0 <expr>`. */
  schedule: string;
  /** Task content appended to the (employee, chat) agent session on each trigger. */
  content: string;
  enabled: boolean;
  /** UNIX timestamp in seconds.
   */
  createdAt: number;
  /** UNIX timestamp in seconds of the last run (null when never run). */
  lastRunAt: number | null;
  /** UNIX timestamp in seconds of the next run (best-effort; null when none). */
  nextRunAt: number | null;
}

/**
 * A cron job enriched for display in the Employees detail pane: the owning
 * chat's title is resolved in main (the renderer chat cache is root-only and
 * cannot resolve spawned group chats).
 */
export interface CronJobInfo extends CronJob {
  /** `chats.title` of the job's chat (may be empty for an untitled chat). */
  chatTitle: string;
}

export interface CronJobInput {
  id: string;
  chatId: number;
  employeeId: number;
  schedule: string;
  content: string;
}

export interface ParsedCronJobId {
  chatId: number;
  employeeId: number;
  jobId: string;
}

export interface CronJobRow {
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
