import type { ChatSummary } from "@shared/types";
import { useEffect, useState } from "react";
import {
  getCachedChatSummary,
  setCachedChatSummary,
  subscribeChatSummary,
} from "../../../chat-summary-cache";

/**
 * Resolve the `ChatSummary` behind a link card's chat id.
 *
 * Returns `undefined` while loading, `null` when the chat is missing or was
 * deleted, and the summary once resolved (served synchronously from the shared
 * cache on remount).
 *
 * The cache itself (`chat-summary-cache`) is owned by the app store: whenever
 * the store re-reads a summary (`refreshChatSummary`, driven by
 * `messages:changed` / `chats:changed`) it pushes the new value into the cache
 * and every mounted card is notified. Without that, a card kept rendering the
 * member list it saw on mount — which is how a group chat's avatar could revert
 * to fewer members after a refresh elsewhere.
 *
 * `chatId === null` — a card with no link at all — resolves to `null`, i.e.
 * "no conversation to open".
 */
export function useChatSummary(
  chatId: number | null,
): ChatSummary | null | undefined {
  const [summary, setSummary] = useState<ChatSummary | null | undefined>(() =>
    chatId === null ? null : getCachedChatSummary(chatId),
  );

  useEffect(() => {
    if (chatId === null) {
      setSummary(null);
      return;
    }
    const cached = getCachedChatSummary(chatId);
    setSummary(cached);
    // Canonical React async-effect pattern: a synchronous callback plus an
    // `ignore` flag so a stale response never updates an unmounted component.
    let ignore = false;
    if (cached === undefined) {
      void (async () => {
        try {
          const result = await imb.chats.summary(chatId);
          // Cache only successful lookups: a missing chat must be re-checked on
          // the next mount instead of staying a permanent negative entry that a
          // reused id would inherit. Writing it also notifies every other card
          // showing the same chat (one IPC read for all of them).
          if (result !== null) setCachedChatSummary(result);
          if (!ignore) setSummary(result);
        } catch {
          if (!ignore) setSummary(null);
        }
      })();
    }
    const off = subscribeChatSummary(chatId, (next) => {
      if (!ignore) setSummary(next);
    });
    return () => {
      ignore = true;
      off();
    };
  }, [chatId]);

  return summary;
}
