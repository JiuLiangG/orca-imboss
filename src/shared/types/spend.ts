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
export type SpendRange = "today" | "week" | "month" | "all";

/** Dimension the Spend list is grouped by (switchable in the list header). */
export type SpendGrouping = "chat" | "employee";

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

/**
 * One bucket of the spend trend chart. For the "today" window each bucket is
 * an hour of the local day (key `HH`, `00`–`23`); for "week"/"month" each
 * bucket is a local calendar day (key `YYYY-MM-DD`).
 */
export interface SpendTrendBucket {
  key: string;
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
  /**
   * Per-conversation breakdown, most recent first (the root chat's last
   * message time, matching the chat module's list order), capped to the last
   * `SPEND_EMPLOYEE_RECENT_CHATS` entries server-side.
   */
  byChat: SpendEmployeeChatReport[];
  /** Total conversations before the `byChat` cap (for the "showing N of M" hint). */
  byChatTotal: number;
  /** Dense trend series for the requested window; empty for "all". */
  trend: SpendTrendBucket[];
}

/** One employee's usage inside a single conversation. */
export interface SpendChatEmployeeReport {
  employeeId: number;
  /** Employee name, or `Employee #<id>` for a row that no longer exists. */
  name: string;
  /** Employee role text; empty string when unknown. */
  role: string;
  totals: SpendTotals;
}

/** Usage one employee spent inside a single conversation. */
export interface SpendEmployeeChatReport {
  chatId: number;
  /** Chat title from the DB; empty string when the chat is untitled. */
  title: string;
  totals: SpendTotals;
}

/** Usage for one conversation (chat), aggregating every employee in it. */
export interface SpendChatReport {
  chatId: number;
  /** Chat title from the DB; empty string when the chat is untitled. */
  title: string;
  /** Distinct employees that spent tokens in this conversation. */
  employees: SpendChatEmployeeReport[];
  totals: SpendTotals;
  byModel: SpendModelBreakdown[];
}

/** Payload of `spend:report`. */
export interface SpendReport {
  range: SpendRange;
  /** Epoch ms when the report was produced. */
  generatedAt: number;
  /** Grand total across every employee. */
  totals: SpendTotals;
  byModel: SpendModelBreakdown[];
  /** Dense trend series for the requested window; empty for "all". */
  trend: SpendTrendBucket[];
  /** Per-employee rows, most expensive first. */
  employees: SpendEmployeeReport[];
  /** Per-conversation rows (all chats, incl. task group chats), most expensive first. */
  chats: SpendChatReport[];
}
