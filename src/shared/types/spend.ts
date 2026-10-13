/**
 * Usage statistics aggregated from the persisted Pi session JSONL files.
 *
 * Every provider call a session made is recorded in its JSONL — assistant
 * responses (`message.usage`), model-attributed `usage` entries (cache warming
 * and the like), and the optional `usage` on `compaction` / `branch_summary`
 * entries. None of it is mirrored in SQLite, so the main process streams those
 * files and sums them per employee (the "role" breakdown) plus a grand total.
 */

/** Preset time window for a usage report. */
export type SpendRange = "today" | "7d" | "30d" | "all";

/** Token + cost counters shared by every aggregation level. */
export interface SpendTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
  /** Number of provider calls folded into these counters. */
  calls: number;
}

/** Usage attributed to one provider/model pair. */
export interface SpendModelBreakdown {
  provider: string;
  model: string;
  totals: SpendTotals;
}

/** Usage for one local calendar day (`YYYY-MM-DD`). */
export interface SpendDayBreakdown {
  date: string;
  totals: SpendTotals;
}

/** One employee's usage within the requested range. */
export interface SpendEmployeeReport {
  employeeId: number;
  /** Employee name, or `Employee #<id>` for a row that no longer exists. */
  name: string;
  /** Employee role text; empty string when unknown. */
  role: string;
  /** Number of distinct chats this employee spent tokens in. */
  chats: number;
  totals: SpendTotals;
  byModel: SpendModelBreakdown[];
  byDay: SpendDayBreakdown[];
}

/** Payload of `spend:report`. */
export interface SpendReport {
  range: SpendRange;
  /** Epoch ms when the report was produced. */
  generatedAt: number;
  /** Grand total across every employee. */
  totals: SpendTotals;
  byModel: SpendModelBreakdown[];
  byDay: SpendDayBreakdown[];
  /** Per-employee rows, most expensive first. */
  employees: SpendEmployeeReport[];
}
