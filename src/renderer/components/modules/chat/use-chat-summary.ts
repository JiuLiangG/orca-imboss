import type { ChatSummary } from "@shared/types";
import { useEffect, useState } from "react";
import { onChatsDeleted } from "../../../chat-events";

/**
 * Resolved chat summaries, keyed by chat id, shared by every link card that
 * jumps to a conversation (`ChatCard`, `ProgressCard`). Only successful
 * lookups are cached: a missing chat (`null`) is never stored, so it cannot
 * become a permanent negative cache that later masks a chat created under a
 * reused id.
 */
const summaryCache = new Map<number, ChatSummary>();

/**
 * One-time binding that drops shared cache entries for cascade-deleted chats,
 * so a later mount of a card for a deleted chat cannot reuse a stale summary.
 *
 * Goes through the shared `chats:deleted` dispatcher (`chat-events`) rather
 * than subscribing to the IPC channel itself: the per-card subscriptions below
 * are the reason that channel used to exceed its listener limit.
 */
let summaryCacheCleanupBound = false;
function bindSummaryCacheCleanup(): void {
  if (summaryCacheCleanupBound) return;
  summaryCacheCleanupBound = true;
  onChatsDeleted((chatIds) => {
    for (const id of chatIds) summaryCache.delete(id);
  });
}

/**
 * Resolve the `ChatSummary` behind a link card's chat id.
 *
 * Returns `undefined` while loading, `null` when the chat is missing or was
 * deleted, and the summary once resolved (served synchronously from the shared
 * cache on remount). `chatId === null` — a card with no link at all — resolves
 * to `null`, i.e. "no conversation to open".
 */
export function useChatSummary(
  chatId: number | null,
): ChatSummary | null | undefined {
  const [summary, setSummary] = useState<ChatSummary | null | undefined>(() =>
    chatId === null ? null : summaryCache.get(chatId),
  );

  useEffect(() => {
    if (chatId === null) {
      setSummary(null);
      return;
    }
    const cached = summaryCache.get(chatId);
    if (cached !== undefined) {
      setSummary(cached);
      return;
    }
    // Canonical React async-effect pattern: a synchronous callback plus an
    // `ignore` flag so a stale response never updates an unmounted component.
    let ignore = false;
    void (async () => {
      try {
        const result = await imb.chats.summary(chatId);
        // Cache only successful lookups: a missing chat must be re-checked on
        // the next mount instead of staying a permanent negative entry that a
        // reused id would inherit.
        if (result !== null) summaryCache.set(chatId, result);
        if (!ignore) setSummary(result);
      } catch {
        if (!ignore) setSummary(null);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [chatId]);

  // A cascade delete removes the linked chat: drop the shared cache entry
  // (globally, once bound) and disable this card's link locally.
  useEffect(() => {
    bindSummaryCacheCleanup();
    if (chatId === null) return;
    const off = onChatsDeleted((chatIds) => {
      if (chatIds.includes(chatId)) {
        summaryCache.delete(chatId);
        setSummary(null);
      }
    });
    return off;
  }, [chatId]);

  return summary;
}
