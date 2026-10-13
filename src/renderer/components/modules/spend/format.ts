import { getLocale } from "@shared/l10n";

const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(): Intl.NumberFormat {
  const locale = getLocale();
  let format = formatters.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    formatters.set(locale, format);
  }
  return format;
}

/** Full token count with locale grouping (e.g. `1,234,567`). */
export function formatTokens(value: number): string {
  return numberFormat().format(Math.round(value));
}

/** Compact token count for tight rows (e.g. `1.2K`, `3.4M`). */
export function formatTokensCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  }
  return String(Math.round(value));
}

/** Cost in USD; small amounts keep extra precision so they never read `$0.00`. */
export function formatCost(value: number): string {
  const digits = value === 0 ? 2 : value < 0.01 ? 4 : value < 1 ? 3 : 2;
  return `$${value.toFixed(digits)}`;
}

/** `YYYY-MM-DD` → `MM-DD`, for compact axis labels. */
export function formatDayShort(date: string): string {
  return date.slice(5);
}
