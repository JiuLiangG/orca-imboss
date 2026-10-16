import type { ChatSummary } from "@shared/types";
import { t } from "@shared/l10n";

export type ChatListRow =
  | { kind: "group"; id: string; label: string; count: number }
  | { kind: "chat"; chat: ChatSummary };

/**
 * Groups chats into "Pinned", "Today", "Yesterday", "This week", and "Earlier".
 * Completely self-contained helper for the chat list.
 */
export function groupChatsByDate(
  chats: readonly ChatSummary[],
): ChatListRow[] {
  if (chats.length === 0) return [];

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  // Monday is start of the week: getDay() 0 is Sunday -> dayFromMonday = 6; 1..6 -> day - 1
  const day = now.getDay();
  const dayFromMonday = (day + 6) % 7;
  const startOfThisWeek = startOfToday - dayFromMonday * 24 * 60 * 60 * 1000;

  const pinnedChats: ChatSummary[] = [];
  const todayChats: ChatSummary[] = [];
  const yesterdayChats: ChatSummary[] = [];
  const thisWeekChats: ChatSummary[] = [];
  const earlierChats: ChatSummary[] = [];

  for (const chat of chats) {
    if (chat.pinned) {
      pinnedChats.push(chat);
      continue;
    }

    // Recency timestamp in milliseconds. ChatSummary.lastMessageAt is a UNIX
    // timestamp in seconds (falling back to createdAt for a new chat with no messages).
    const secs =
      typeof chat.lastMessageAt === "number" && chat.lastMessageAt > 0
        ? chat.lastMessageAt
        : typeof chat.lastAt === "number" && chat.lastAt > 0
          ? chat.lastAt
          : typeof chat.createdAt === "number"
            ? chat.createdAt
            : 0;
    const tsMillis = secs * 1000;

    if (tsMillis >= startOfToday) {
      todayChats.push(chat);
    } else if (tsMillis >= startOfYesterday) {
      yesterdayChats.push(chat);
    } else if (tsMillis >= startOfThisWeek) {
      thisWeekChats.push(chat);
    } else {
      earlierChats.push(chat);
    }
  }

  const sections: { key: string; label: string; items: ChatSummary[] }[] = [
    { key: "pinned", label: t("Pinned"), items: pinnedChats },
    { key: "today", label: t("Today"), items: todayChats },
    { key: "yesterday", label: t("Yesterday"), items: yesterdayChats },
    { key: "thisWeek", label: t("This week"), items: thisWeekChats },
    { key: "earlier", label: t("Earlier"), items: earlierChats },
  ];

  const rows: ChatListRow[] = [];
  for (const section of sections) {
    if (section.items.length === 0) continue;
    rows.push({
      kind: "group",
      id: `group:${section.key}`,
      label: section.label,
      count: section.items.length,
    });
    for (const chat of section.items) {
      rows.push({
        kind: "chat",
        chat,
      });
    }
  }

  return rows;
}
