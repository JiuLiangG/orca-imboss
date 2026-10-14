import type { SpendGrouping, SpendRange } from "../types/spend";

/**
 * Master switch for the Spend module (per-employee token + cost statistics).
 *
 * The feature is self-contained — `shared/types/spend.ts`,
 * `shared/constants/spend.ts`, `main/spend.ts`, `main/ipc/spend.ts` and
 * `renderer/components/modules/spend/` — and this constant is its single
 * integration point, so a developer can take it in whichever form suits the
 * project:
 *
 * - leave it `true` to ship the module (nav entry + the `spend:report` IPC);
 * - set it `false` to drop it entirely: the nav entry, the module view and the
 *   IPC handler all disappear and nothing else needs to change;
 * - replace it with a stored setting read (`SettingKeys` + `imb.settings`) to
 *   expose it as a user option;
 * - or drop the commit to leave no trace.
 */
export const SPEND_STATS_ENABLED = true;

/** Range presets shown in the Spend module, in display order. */
export const SPEND_RANGES: readonly SpendRange[] = [
  "today",
  "week",
  "month",
  "all",
];

/** Translation keys for each range preset. */
export const SPEND_RANGE_LABELS: Record<SpendRange, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  all: "Total",
};

export function isSpendRange(value: unknown): value is SpendRange {
  return (
    value === "today" ||
    value === "week" ||
    value === "month" ||
    value === "all"
  );
}

/** Grouping dimensions shown in the Spend module, in display order. */
export const SPEND_GROUPINGS: readonly SpendGrouping[] = ["chat", "employee"];

/** Translation keys for each grouping dimension. */
export const SPEND_GROUPING_LABELS: Record<SpendGrouping, string> = {
  chat: "By conversation",
  employee: "By employee",
};

export function isSpendGrouping(value: unknown): value is SpendGrouping {
  return value === "chat" || value === "employee";
}
