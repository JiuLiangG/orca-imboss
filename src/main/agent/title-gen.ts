import { ASSISTANT_ID } from "@shared/constants/employees";
import { getChat, updateChatTitle } from "../db/chats";
import { getEmployee } from "../db/employees";
import { sendToRenderer } from "../notifications";
import { getModelRuntime, resolveModel } from "./model-runtime";

/**
 * Auto-title generation for untitled chats.
 *
 * When the first user message of a chat is processed (`chat:send`) and the
 * chat has no title yet, a one-shot completion proposes a short title from
 * that message. The call is fire-and-forget: it never blocks or fails the
 * send itself. On any failure the chat simply stays untitled — the
 * `title === ""` guard makes the *next* message retry generation, so no
 * explicit retry bookkeeping is needed.
 *
 * A per-chat in-flight set prevents duplicate runs when the user sends a
 * burst of messages before the first generation resolves.
 */

/** Generation is aborted after this long so a hung provider cannot pin the guard. */
const TITLE_TIMEOUT_MS = 20_000;

/** Upper bound for a generated title (matches `updateChatTitle`'s DB limit). */
const MAX_TITLE_LENGTH = 200;

/** Chats with a generation currently in flight (by chat id). */
const inFlight = new Set<number>();

/** Longest slice of the user message embedded in the title prompt. */
const MAX_PROMPT_MESSAGE_CHARS = 2_000;

/**
 * Generate and store a title for `chatId` from `userMessage` when the chat
 * is untitled. Fire-and-forget: returns immediately, never rejects.
 */
export function maybeGenerateChatTitle(
  chatId: number,
  userMessage: string,
): void {
  const chat = getChat(chatId);
  if (!chat) return;
  if (chat.title.trim().length > 0) return;
  const message = userMessage.trim();
  if (message.length === 0) return;
  if (inFlight.has(chatId)) return;
  inFlight.add(chatId);
  void generate(chatId, message).finally(() => {
    inFlight.delete(chatId);
  });
}

async function generate(chatId: number, message: string): Promise<void> {
  try {
    const title = await requestTitle(message);
    if (title === null) return;
    // The chat may have been renamed (or deleted) while the call was in
    // flight — never clobber a title that appeared meanwhile.
    const current = getChat(chatId);
    if (!current || current.title.trim().length > 0) return;
    updateChatTitle(chatId, title);
    sendToRenderer("chats:changed", { chatId });
  } catch (err) {
    // Stay untitled; the next message retries. The send itself already
    // succeeded, so this is logged and swallowed.
    console.error(
      "[title-gen] failed to generate chat title:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * One-shot completion asking for a chat title in the message's own language.
 * Returns the sanitized title, or `null` when the model produced nothing
 * usable (the chat then stays untitled).
 */
async function requestTitle(message: string): Promise<string | null> {
  const modelRuntime = await getModelRuntime();
  const model = resolveModel(modelRuntime, getEmployee(ASSISTANT_ID)?.modelId);
  if (!model) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);
  try {
    const response = await modelRuntime.completeSimple(
      model,
      {
        systemPrompt:
          "You propose titles for chats. Given the user's first message, " +
          "reply with ONLY a concise chat title (a few words, at most 40 " +
          "characters): no quotes, no colon prefix, no trailing punctuation, " +
          "no explanation. Write the title in the same language as the " +
          "message.",
        messages: [
          {
            role: "user",
            content: message.slice(0, MAX_PROMPT_MESSAGE_CHARS),
            timestamp: Date.now(),
          },
        ],
      },
      { signal: controller.signal, maxTokens: 100 },
    );
    if (response.stopReason === "error" || response.stopReason === "aborted") {
      return null;
    }
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    return sanitizeTitle(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn raw model output into a single-line title within the DB limit.
 * Returns `null` when nothing usable remains.
 */
function sanitizeTitle(raw: string): string | null {
  // Models occasionally wrap the answer or prefix it; take the first non-empty
  // line, drop surrounding quotes, and strip a stray "Title:" label.
  const firstLine = raw
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  const withoutLabel = firstLine.replace(/^Title\s*[:：]\s*/i, "");
  const unquoted = withoutLabel.replace(/^["'“”«»]+|["'“”«»]+$/gu, "");
  const cleaned = unquoted.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, MAX_TITLE_LENGTH);
}
