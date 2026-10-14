import { getLocale, t } from "@shared/l10n";
import cronstrue from "cronstrue";
import "cronstrue/locales/zh_CN";

/** Map the app locale (`en` / `zh-CN`) to a cronstrue locale name. */
function cronstrueLocale(locale: string): string {
  return locale === "zh-CN" ? "zh_CN" : "en";
}

/** Plain-language schedule text; falls back to the raw expression on failure. */
export function describeSchedule(schedule: string): string {
  try {
    return cronstrue.toString(schedule, {
      locale: cronstrueLocale(getLocale()),
      use24HourTimeFormat: true,
    });
  } catch {
    return schedule;
  }
}

/** Locale-aware absolute date-time for a `next_run_at` epoch second. */
export function formatRunTime(at: number | null): string {
  if (at === null) return t("Not scheduled");
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(at * 1000));
  } catch {
    return new Date(at * 1000).toLocaleString();
  }
}
