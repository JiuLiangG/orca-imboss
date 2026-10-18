/**
 * Bookkeeping for steered ("interjected") messages that may be lost when a run
 * is interrupted.
 *
 * ## Why this exists
 *
 * A message delivered with `mode: "steer"` is handed to the live Pi run:
 * `AgentSession.steer()` pushes the text into Pi's steering queue **and** hands
 * it to the low-level agent (`agent.steer`), which injects it as a user message
 * at the next turn boundary and then persists it. That leaves three states for
 * a steered text when the boss hits interrupt:
 *
 * 1. **Still queued in Pi** — it never reached the conversation. Pi's own
 *    `clearQueue()` returns it (Pi also removes a text from that queue only once
 *    the corresponding user message *starts*, so the queue is an exact record of
 *    "not injected yet").
 * 2. **Injected and persisted** — it is part of the transcript and the model saw
 *    it. Pi emits a `message_end` event for that user message, which the queue
 *    records as "delivered".
 * 3. **Handed over but neither queued nor persisted** — the abort cut the run
 *    between the two. This is the case that silently loses the boss's message;
 *    only the app's own ledger knows the text existed.
 *
 * So: the app records every text it successfully handed over (`pendingSteers`),
 * counts the ones Pi confirmed as persisted (`deliveredSteers`), and on an
 * interrupt re-queues exactly `handedOver - delivered`. Two identical messages
 * are counted per copy, never collapsed.
 *
 * Comparison is exact after `trim()` (no other normalisation): two texts that
 * differ only in surrounding whitespace are treated as different messages, which
 * can at worst deliver one copy twice — never drop one.
 */

/** Normalised comparison key: the text without surrounding whitespace. */
function normalize(text: string): string {
  return text.trim();
}

/** Count occurrences of each normalised text. */
function countByText(texts: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const key = normalize(text);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Which handed-over texts never made it into the transcript.
 *
 * `handedOver` is several viewpoints on the *same* set of messages (the app's own
 * ledger, Pi's steering queue, Pi's follow-up queue), so the views are merged
 * with **max** per text — a text visible from two views is still one message.
 * `delivered` is how many copies Pi persisted. The result keeps the first-seen
 * order of `handedOver` and repeats a text as often as it is missing.
 *
 * Empty texts are dropped; every delivered copy cancels one handed-over copy.
 */
export function takeUndelivered(
  handedOver: readonly (readonly string[])[],
  delivered: readonly string[],
): string[] {
  const deliveredCount = countByText(delivered);
  const order: string[] = [];
  /** First original spelling per normalised key (re-queued verbatim). */
  const original = new Map<string, string>();
  const handedCount = new Map<string, number>();

  for (const list of handedOver) {
    for (const [key, count] of countByText(list)) {
      if (key.length === 0) continue;
      if (!handedCount.has(key)) {
        order.push(key);
        original.set(key, list.find((text) => normalize(text) === key) ?? key);
      }
      handedCount.set(key, Math.max(handedCount.get(key) ?? 0, count));
    }
  }

  const out: string[] = [];
  for (const key of order) {
    const missing =
      (handedCount.get(key) ?? 0) - (deliveredCount.get(key) ?? 0);
    const text = original.get(key) ?? key;
    for (let i = 0; i < missing; i += 1) out.push(text);
  }
  return out;
}

/**
 * Plain text of a Pi user message's `content` (string or content blocks).
 * Used to match a `message_end` event against the steer ledger.
 */
export function userMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const candidate = block as { type?: unknown; text?: unknown };
    if (candidate.type === "text" && typeof candidate.text === "string") {
      parts.push(candidate.text);
    }
  }
  return parts.join("\n");
}
