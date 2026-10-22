/**
 * Timestamp formatting for the chat UI.
 *
 * Chat-list / thread-divider times are relative: today → "HH:mm"; yesterday →
 * 昨天/“Yesterday”; within a week → 周X / Tue; else yyyy/M/d. Message rows use
 * the full timestamp instead (no relative logic).
 */

import { t } from "@shared/l10n";
import type { Message } from "@shared/types";

const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Messages closer together than this share one divider: the thread shows a
 * rough time per group (WeChat-style), not one per bubble. The exact time of
 * any single bubble stays reachable on hover instead.
 */
export const TIME_SEPARATOR_GAP_SECS = 5 * 60;

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayDiff(a: Date, b: Date): number {
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((startB - startA) / 86_400_000);
}

/** `HH:mm` in the viewer's local time. */
function clockTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Day part of a timestamp relative to now: empty for today, 昨天/Yesterday,
 * the weekday within the last week, else `yyyy/M/d`. Shared by the chat-list
 * time and the thread's message-group dividers so the two never disagree.
 */
function dayLabel(date: Date, locale: string, now: Date): string {
  if (sameDay(date, now)) return "";
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (sameDay(date, yesterday)) {
    return locale === "zh-CN" ? "昨天" : "Yesterday";
  }
  const diff = dayDiff(date, now);
  if (diff < 7 && diff >= 0) {
    const names = locale === "zh-CN" ? WEEKDAYS_ZH : WEEKDAYS_EN;
    return names[date.getDay()];
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatChatTime(
  secs: number | null | undefined,
  locale: string,
): string {
  if (secs == null) return "";
  const date = new Date(secs * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const label = dayLabel(date, locale, new Date());
  return label.length > 0 ? label : clockTime(date);
}

/**
 * Label of a message-group divider: the clock time while the group is from
 * today, day-qualified once it starts on an earlier day (`昨天 09:12`,
 * `周三 09:12`, `2026/10/14 09:12`).
 */
export function formatTimeSeparator(secs: number, locale: string): string {
  const date = new Date(secs * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const label = dayLabel(date, locale, new Date());
  return label.length > 0 ? `${label} ${clockTime(date)}` : clockTime(date);
}

/**
 * Whether a divider belongs above `current`. The first message always gets
 * one, as does any message that opens a new group — a gap of
 * `TIME_SEPARATOR_GAP_SECS` or more, or a new calendar day (a short gap
 * across midnight still starts a new day).
 */
export function shouldShowTimeSeparator(
  previous: Message | undefined,
  current: Message,
): boolean {
  if (previous === undefined) return true;
  const before = new Date(previous.createdAt * 1000);
  const after = new Date(current.createdAt * 1000);
  if (!sameDay(before, after)) return true;
  return current.createdAt - previous.createdAt >= TIME_SEPARATOR_GAP_SECS;
}

/** Full timestamp for message rows (locale-aware, no relative logic). */
export function formatMessageTime(secs: number, locale: string): string {
  const date = new Date(secs * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (locale === "zh-CN") {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${hh}:${mm}`;
}

/**
 * Chat title for display: untitled chats fall back to the localized default at
 * render time (the DB stores `""` for a new chat, so the fallback follows
 * locale switches). Shared by the chat list and the composer's conversation
 * picker so both show the same title and derived letter avatar.
 */
export function displayTitle(title: string): string {
  return title.trim().length > 0 ? title : t("New Chat");
}
