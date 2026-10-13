import type { SpendRange } from "../types/spend";

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
  "7d",
  "30d",
  "all",
];

/** Translation keys for each range preset. */
export const SPEND_RANGE_LABELS: Record<SpendRange, string> = {
  today: "Today",
  "7d": "7D",
  "30d": "30D",
  all: "All",
};

export function isSpendRange(value: unknown): value is SpendRange {
  return (
    value === "today" || value === "7d" || value === "30d" || value === "all"
  );
}

/**
 * Most recent calendar days the daily trend plots. A longer window still sums
 * into the totals; the chart only renders the tail so one bar stays legible.
 */
export const SPEND_TREND_MAX_DAYS = 90;
