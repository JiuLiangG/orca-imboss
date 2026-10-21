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
 * that message. If generation fails or returns empty, falls back to a snippet
 * of the user message so chats never linger untitled.
 *
 * A per-chat in-flight set prevents duplicate runs when the user sends a
 * burst of messages before the first generation resolves.
 *
 * Transient provider failures are retried: a 503/network/rate-limit blip is the
 * common case, and a second or third try usually yields the model title instead
 * of the message-snippet fallback. Retries share ONE wall-clock budget with the
 * first attempt (`TITLE_TOTAL_BUDGET_MS`, the same 20s a single attempt used to
 * get), so a fast failure can spend its retries while a hung provider simply
 * exhausts the budget — an untitled chat never waits much longer than before.
 */

/**
 * Total wall-clock budget for one title generation, retry backoff included.
 *
 * Deliberately equal to the old single-attempt timeout: retrying must not make
 * an untitled chat wait noticeably longer than it already could.
 */
const TITLE_TOTAL_BUDGET_MS = 20_000;

/** Attempts per generation: the first request plus at most two retries. */
const TITLE_MAX_ATTEMPTS = 3;

/**
 * Cap for a single attempt. Two capped attempts plus their backoff still fit in
 * the budget, so one hung request cannot starve the retries.
 */
const TITLE_ATTEMPT_TIMEOUT_MS = 8_000;

/** An attempt shorter than this is pointless — it would be cut off at once. */
const TITLE_MIN_ATTEMPT_MS = 2_000;

/** Backoff before retry N is `base * 2^(N-1)` (1s, 2s), jittered down a bit. */
const TITLE_RETRY_BASE_DELAY_MS = 1_000;

/**
 * Jitter ratio for the backoff: the delay is shortened by a random 0–25%, so a
 * burst of chats failing together does not retry in lockstep.
 */
const TITLE_RETRY_JITTER_RATIO = 0.25;

/** Upper bound for a generated title (matches `updateChatTitle`'s DB limit). */
const MAX_TITLE_LENGTH = 200;

/** Chats with a generation currently in flight (by chat id). */
const inFlight = new Set<number>();

/** Longest slice of the user message embedded in the title prompt. */
const MAX_PROMPT_MESSAGE_CHARS = 2_000;

/**
 * Stable routing key for the one-shot title request, scoped to the chat.
 *
 * OpenCode (the `opencode`/`opencode-go` providers) requires a stable
 * `x-opencode-session` header per conversation and rejects requests without it
 * (400 `MissingSessionID`). Pi's provider only adds that header when the
 * request options carry a `sessionId`; the agent session always supplies one
 * (its pi session id), a one-shot `completeSimple` call does not. A
 * chat-scoped id is stable for the conversation's whole lifetime and needs no
 * session-file reads, which matters because title generation runs alongside
 * the first agent turn rather than inside it.
 */
function titleSessionId(chatId: number): string {
  return `imboss-chat-${chatId}`;
}

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

/** First non-empty line of the message, condensed and capped, as a fallback title. */
function deriveFallbackTitle(message: string): string | null {
  const line = message
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return null;
  const cleaned = line.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned;
}

async function generate(chatId: number, message: string): Promise<void> {
  let title: string | null = null;
  try {
    title = await requestTitleWithRetry(chatId, message);
  } catch (err) {
    // Defensive: the retry loop never throws, but a failure here must still
    // never break the send path — the fallback title keeps working.
    console.error(
      "[title-gen] failed to generate chat title:",
      err instanceof Error ? err.message : err,
    );
  }

  const finalTitle = title ?? deriveFallbackTitle(message);
  if (finalTitle === null) return;

  const current = getChat(chatId);
  if (!current || current.title.trim().length > 0) return;
  updateChatTitle(chatId, finalTitle);
  sendToRenderer("chats:changed", { chatId });
}

/** Outcome of one title request attempt. */
type TitleAttempt =
  /** `title: null` = the model produced nothing usable (retrying won't help). */
  | { ok: true; title: string | null }
  /** `retryable` = another attempt may succeed; `reason` is log/text only. */
  | { ok: false; retryable: boolean; reason: string };

/**
 * Ask the model for a title, retrying transient failures at most
 * `TITLE_MAX_ATTEMPTS - 1` times inside one shared wall-clock budget.
 *
 * Returns the generated title, or `null` when every attempt failed or produced
 * nothing usable (the caller then writes the message-snippet fallback). Never
 * throws.
 */
async function requestTitleWithRetry(
  chatId: number,
  message: string,
): Promise<string | null> {
  const deadline = Date.now() + TITLE_TOTAL_BUDGET_MS;
  let attempts = 0;
  let lastReason = "no attempt was made";

  for (let attempt = 1; attempt <= TITLE_MAX_ATTEMPTS; attempt++) {
    // A request that would be aborted after `TITLE_MIN_ATTEMPT_MS` cannot
    // succeed, so sending it would only burn budget and a model call.
    if (deadline - Date.now() < TITLE_MIN_ATTEMPT_MS) break;
    const timeoutMs = Math.min(TITLE_ATTEMPT_TIMEOUT_MS, deadline - Date.now());
    attempts = attempt;

    const outcome = await attemptTitle(chatId, message, timeoutMs);
    if (outcome.ok) {
      if (attempt > 1) {
        console.warn(
          `[title-gen] chat ${chatId} titled on attempt ${attempt}/${TITLE_MAX_ATTEMPTS}.`,
        );
      }
      return outcome.title;
    }

    lastReason = outcome.reason;
    if (!outcome.retryable || attempt >= TITLE_MAX_ATTEMPTS) break;

    const delayMs = retryDelayMs(attempt);
    if (Date.now() + delayMs + TITLE_MIN_ATTEMPT_MS > deadline) {
      console.warn(
        `[title-gen] chat ${chatId}: no budget left for retry ${attempt} ` +
          `(needs ${delayMs}ms backoff plus a usable attempt).`,
      );
      break;
    }
    console.warn(
      `[title-gen] attempt ${attempt}/${TITLE_MAX_ATTEMPTS} for chat ${chatId} ` +
        `failed, retrying in ${delayMs}ms: ${lastReason}`,
    );
    await sleep(delayMs);
  }

  console.error(
    `[title-gen] giving up on the title for chat ${chatId} after ` +
      `${attempts} attempt(s): ${lastReason}`,
  );
  return null;
}

/** One attempt, with thrown errors normalized into the attempt outcome. */
async function attemptTitle(
  chatId: number,
  message: string,
  timeoutMs: number,
): Promise<TitleAttempt> {
  try {
    return await requestTitle(chatId, message, timeoutMs);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, retryable: isRetryableTitleError(reason), reason };
  }
}

/** Backoff before retry `attempt` (1-indexed): exponential, downward jitter. */
function retryDelayMs(attempt: number): number {
  const base = TITLE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  const jitter = 1 - Math.random() * TITLE_RETRY_JITTER_RATIO;
  return Math.round(base * jitter);
}

/** Sleep helper for the backoff (bounded by the budget check before it). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One-shot completion asking for a chat title in the message's own language.
 *
 * Returns `{ ok: true, title }` where `title` is `null` when the model produced
 * nothing usable, or a failed outcome carrying whether another attempt makes
 * sense (see `isRetryableTitleError`).
 */
async function requestTitle(
  chatId: number,
  message: string,
  timeoutMs: number,
): Promise<TitleAttempt> {
  const modelRuntime = await getModelRuntime();
  const model = resolveModel(modelRuntime, getEmployee(ASSISTANT_ID)?.modelId);
  if (!model) {
    return {
      ok: false,
      // Configuration, not a transient failure: retrying resolves nothing.
      retryable: false,
      reason:
        `no model resolved for chat ${chatId} ` +
        `(available models: ${modelRuntime.getAvailableSnapshot().length})`,
    };
  }

  const controller = new AbortController();
  // Our own timer is the only abort source today; the flag keeps a future
  // caller-driven cancel terminal instead of being mistaken for a timeout.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
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
      {
        signal: controller.signal,
        maxTokens: 512,
        // Retrying is this module's job (`requestTitleWithRetry`): letting the
        // provider layer retry too would multiply the attempts (3 app attempts
        // × the provider's own 2 = up to 9 billed requests) and its sleeps
        // would ignore our wall-clock budget.
        maxRetries: 0,
        // Required by OpenCode Go's routing (`x-opencode-session`); ignored by
        // providers without session support.
        sessionId: titleSessionId(chatId),
      },
    );
    if (response.stopReason === "error") {
      // `errorMessage` carries the provider's status/body (e.g.
      // `503: {"type":"server_error",...}` or a 400 from the routing layer).
      const reason =
        response.errorMessage?.trim() ||
        "model call failed without an error message";
      return { ok: false, retryable: isRetryableTitleError(reason), reason };
    }
    if (response.stopReason === "aborted") {
      return timedOut
        ? {
            ok: false,
            retryable: true,
            reason: `model call timed out after ${timeoutMs}ms`,
          }
        : { ok: false, retryable: false, reason: "model call was aborted" };
    }
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    return { ok: true, title: sanitizeTitle(text) || sanitizeTitle(message) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provider failures that are NOT worth another attempt: quota, billing and
 * usage-limit errors look like throttling but reset on a schedule (hours), so
 * a retry only burns time. Wording mirrors `@earendil-works/pi-ai`'s
 * `isRetryableAssistantError`, which this app cannot import (pi-ai is not a
 * direct dependency and the coding-agent SDK does not re-export it).
 */
const NON_RETRYABLE_ERROR_RE = new RegExp(
  [
    "GoUsageLimitError",
    "FreeUsageLimitError",
    "Monthly usage limit reached",
    "available balance",
    "insufficient_quota",
    "out of budget",
    "quota exceeded",
    "billing",
    "subscription_sharing_usage_limit_exceeded",
  ].join("|"),
  "i",
);

/**
 * Transient provider/transport wording worth retrying even without an HTTP
 * status prefix (some providers report failures as plain text).
 */
const RETRYABLE_ERROR_RE = new RegExp(
  [
    "overloaded",
    "high demand",
    "at capacity",
    "rate.?limit",
    "too many requests",
    "service.?unavailable",
    "server.?error",
    "internal.?error",
    "provider.?returned.?error",
    "upstream",
    "network.?error",
    "connection.?(?:refused|lost|reset)",
    "fetch failed",
    "getaddrinfo",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "reset before headers",
    "socket hang up",
    "socket connection was closed",
    "timed? out",
    "timeout",
    "terminated",
    "ended without",
    "websocket.?(?:closed|error)",
    "pending stream has been canceled",
    "you can retry your request",
  ].join("|"),
  "i",
);

/** Pi formats a provider HTTP failure as `"<status>: <body>"`. */
const HTTP_STATUS_PREFIX_RE = /^\s*(\d{3})\b/;

/**
 * Decide whether a failed title request is worth another attempt.
 *
 * Retryable: 408/409/429 and every 5xx, plus network/transport wording.
 * Deterministic failures (400 `MissingSessionID`, 401/403, 404, quota and
 * billing exhaustion) are returned as-is so they fail fast.
 */
function isRetryableTitleError(message: string): boolean {
  const text = message.trim();
  // Unknown failure: spend nothing more on it.
  if (text.length === 0) return false;
  // Checked before the status so `429 ... quota exceeded` stays terminal.
  if (NON_RETRYABLE_ERROR_RE.test(text)) return false;

  const status = Number(HTTP_STATUS_PREFIX_RE.exec(text)?.[1]);
  if (Number.isFinite(status) && status > 0) {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  return RETRYABLE_ERROR_RE.test(text);
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
