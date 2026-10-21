/**
 * Renderer-side fan-out for the `chats:deleted` push.
 *
 * The main process broadcasts one event per cascade delete (root chat + every
 * spawned chat it takes down — see `ipc/chat.ts`), and the renderer has an
 * unbounded number of interested parties: the app store (chat list / Nav /
 * focus), the shared summary cache, and *every mounted link card*
 * (`ChatCard`, `ProgressCard`, `InterruptedNotice`), one per message.
 *
 * Subscribing each of them directly to `imb.chats.onDeleted` would put one
 * `ipcRenderer` listener per card on the same channel. The thread views are not
 * virtualized, so a long-running conversation with 9+ link cards pushes the
 * channel past Node's default `maxListeners` (10) and every further card emits
 * another `MaxListenersExceededWarning` — pure noise that also masks a real
 * listener leak if one ever appears.
 *
 * Instead the whole renderer owns **one** `chats:deleted` listener and fans the
 * event out locally through a `Set`. Adding/removing a subscriber is then a
 * cheap set operation and the channel count stays at 1 no matter how many cards
 * are mounted.
 *
 * Trade-off — the IPC listener is bound once and **never unbound**, even when
 * the last subscriber goes away. That mirrors the previous once-bound semantics
 * of the summary cache invalidation: a delete that lands while no subscriber is
 * registered must still be observed by the cache/state owners that registered
 * earlier, and re-binding later would silently miss the events in between. The
 * cost of keeping it is exactly one inert listener.
 */

/** Payload consumers receive: the full set of cascade-deleted chat ids. */
export type ChatsDeletedHandler = (chatIds: number[]) => void;

const handlers = new Set<ChatsDeletedHandler>();
let bound = false;

/**
 * Defensive dispatch: IPC payloads are untrusted at the type level (the
 * preload bridge is `unknown` in practice), a subscriber that throws must not
 * starve the rest, and a subscriber that unsubscribes while handling the event
 * must not corrupt the iteration — hence the filtered copy and the try/catch.
 */
function dispatch(payload: { chatIds?: unknown } | null | undefined): void {
  const raw = payload?.chatIds;
  if (!Array.isArray(raw)) return;
  const chatIds = raw.filter(
    (id): id is number => Number.isSafeInteger(id) && id > 0,
  );
  if (chatIds.length === 0) return;
  for (const handler of [...handlers]) {
    // A handler may have been removed by an earlier handler in this same pass.
    if (!handlers.has(handler)) continue;
    try {
      handler(chatIds);
    } catch (err) {
      console.error("[chat-events] chats:deleted handler failed", err);
    }
  }
}

/**
 * Subscribe to cascade-deleted chats. Returns the unsubscribe function; call it
 * when the subscriber goes away (a `useEffect` cleanup, typically). Calling the
 * returned function twice is a no-op.
 */
export function onChatsDeleted(handler: ChatsDeletedHandler): () => void {
  if (!bound) {
    bound = true;
    imb.chats.onDeleted(dispatch);
  }
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
