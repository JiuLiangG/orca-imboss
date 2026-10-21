import type { ChatSummary } from "@shared/types";
import { onChatsDeleted } from "./chat-events";

/**
 * Shared, **subscribable** cache of `ChatSummary` per chat id.
 *
 * It backs every link card that shows a conversation's composite avatar and
 * title (`ChatCard`, `ProgressCard`, `InterruptedNotice`) and — because the
 * `app-store` writes into it whenever it re-reads a summary — it is also how a
 * participant edit reaches an already-mounted card.
 *
 * Why it cannot be a plain `Map` any more: a summary snapshot goes stale on
 * *every* mutation (a member is added to a task group, the title is generated,
 * unread/pin/mute/tags change), and a stale snapshot handed to
 * `appStore.openChat()` used to overwrite the Nav entry with old data — the
 * group avatar visibly reverted to its previous members. So the cache is
 * invalidated/refreshed by the store (`setCachedChatSummary` /
 * `invalidateChatSummary`) and notifies its subscribers so mounted cards
 * re-render immediately.
 *
 * Ownership rules:
 * - **The store is the writer.** `app-store.refreshChatSummary()` reads a
 *   summary once per event and pushes it here; this module never does IPC of
 *   its own for participants/titles.
 * - A cache miss is the only case where a reader fetches (`useChatSummary`);
 *   the result is written back through here, so all cards share one read.
 * - `null` is never cached: a missing chat must be re-checked on the next
 *   mount instead of becoming a permanent negative entry that a reused id
 *   would inherit.
 */
const cache = new Map<number, ChatSummary>();

/** One callback per mounted reader, keyed by chat id. */
const listeners = new Map<number, Set<(summary: ChatSummary | null) => void>>();

let deletedBindingBound = false;

/**
 * Drop entries for cascade-deleted chats (globally and once), so a later mount
 * of a card for a deleted chat cannot reuse a stale summary.
 *
 * Uses the shared `chats:deleted` fan-out (`chat-events`) rather than the IPC
 * channel: link cards are unbounded in number and each of them used to add its
 * own `ipcRenderer` listener.
 */
function bindDeletedInvalidation(): void {
  if (deletedBindingBound) return;
  deletedBindingBound = true;
  onChatsDeleted((chatIds) => {
    for (const id of chatIds) invalidateChatSummary(id);
  });
}

function notify(chatId: number, summary: ChatSummary | null): void {
  const handlers = listeners.get(chatId);
  if (!handlers) return;
  // Copy + liveness check: a handler may unsubscribe while another handler of
  // the same pass runs, and a throwing handler must not starve the rest.
  for (const handler of [...handlers]) {
    if (!handlers.has(handler)) continue;
    try {
      handler(summary);
    } catch (err) {
      console.error("[chat-summary-cache] listener failed", err);
    }
  }
}

/**
 * Fields the link cards actually render. Used to skip a notification (and the
 * re-render behind it) when a refresh brought back the same data — a summary is
 * re-read on every message of a group chat, so this guard matters.
 */
function sameVisibleSummary(a: ChatSummary, b: ChatSummary): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.fromChatId === b.fromChatId &&
    a.unread === b.unread &&
    a.pinned === b.pinned &&
    a.muted === b.muted &&
    a.participants.length === b.participants.length &&
    a.participants.every((id, index) => id === b.participants[index])
  );
}

/** Read the cached summary, or `undefined` when it has not been resolved yet. */
export function getCachedChatSummary(chatId: number): ChatSummary | undefined {
  return cache.get(chatId);
}

/**
 * Store a freshly read summary and notify this chat's readers. No-op
 * notification when nothing the UI shows changed.
 */
export function setCachedChatSummary(summary: ChatSummary): void {
  bindDeletedInvalidation();
  const previous = cache.get(summary.id);
  cache.set(summary.id, summary);
  if (previous !== undefined && sameVisibleSummary(previous, summary)) return;
  notify(summary.id, summary);
}

/** Forget one chat's summary (deleted, or explicitly invalidated). */
export function invalidateChatSummary(chatId: number): void {
  bindDeletedInvalidation();
  const had = cache.delete(chatId);
  if (had) notify(chatId, null);
}

/**
 * Subscribe to updates of one chat's summary. Returns the unsubscribe function
 * (idempotent); call it from the reader's effect cleanup.
 */
export function subscribeChatSummary(
  chatId: number,
  handler: (summary: ChatSummary | null) => void,
): () => void {
  bindDeletedInvalidation();
  let handlers = listeners.get(chatId);
  if (!handlers) {
    handlers = new Set();
    listeners.set(chatId, handlers);
  }
  handlers.add(handler);
  return () => {
    const current = listeners.get(chatId);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) listeners.delete(chatId);
  };
}
