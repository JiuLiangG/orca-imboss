import type { Message } from "@shared/types";

/** One parsed answer entry (an item of a `kind=answer` message payload). */
export interface AnswerItem {
  questionId: string;
  selected?: string[];
  text?: string;
}

/**
 * Parsed `answer` message payload. `askMessageId` is absent on legacy rows
 * written before answers were stamped with the ask they reply to.
 */
export interface AnswerPayload {
  askMessageId?: number;
  answers: AnswerItem[];
}

/** Defensive parse of the answer payload; returns null on any invalid shape. */
export function parseAnswer(content: string): AnswerPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const answers = record["answers"];
  if (!Array.isArray(answers) || answers.length === 0) return null;
  const result: AnswerItem[] = [];
  for (const item of answers) {
    if (typeof item !== "object" || item === null) continue;
    const a = item as Record<string, unknown>;
    if (typeof a["questionId"] !== "string" || a["questionId"].length === 0) {
      continue;
    }
    const selected = a["selected"];
    result.push({
      questionId: a["questionId"],
      selected: Array.isArray(selected)
        ? selected.filter((s): s is string => typeof s === "string")
        : undefined,
      text: typeof a["text"] === "string" ? a["text"] : undefined,
    });
  }
  if (result.length === 0) return null;
  const askMessageId = record["askMessageId"];
  return {
    askMessageId:
      typeof askMessageId === "number" && Number.isSafeInteger(askMessageId)
        ? askMessageId
        : undefined,
    answers: result,
  };
}

/** Result of pairing `answer` messages with the `ask` messages they reply to. */
export interface AskAnswerPairing {
  /** Ask message id → the first answer message that replies to it. */
  answerByAskId: Map<number, Message>;
  /** Answer message ids folded into an ask card (hidden from the thread). */
  foldedAnswerIds: Set<number>;
}

/**
 * Pair each `ask` message with the answer that replies to it. New answers carry
 * `askMessageId`; legacy answers (written before the link existed) fall back to
 * the most recent unclaimed preceding ask. The first answer wins for a given
 * ask, so any further answer stays visible as a standalone `AnswerCard`.
 */
export function pairAskAnswers(messages: Message[]): AskAnswerPairing {
  const answerByAskId = new Map<number, Message>();
  const foldedAnswerIds = new Set<number>();
  const askIds = new Set<number>();
  for (const message of messages) {
    if (message.kind === "ask") askIds.add(message.id);
  }

  // Pass 1: explicit links are authoritative.
  for (const message of messages) {
    if (message.kind !== "answer") continue;
    const payload = parseAnswer(message.content);
    const askId = payload?.askMessageId;
    if (askId === undefined || !askIds.has(askId)) continue;
    if (answerByAskId.has(askId)) continue;
    answerByAskId.set(askId, message);
    foldedAnswerIds.add(message.id);
  }

  // Pass 2: legacy unlinked answers claim the most recent unclaimed ask.
  const unclaimedAskIds: number[] = [];
  for (const message of messages) {
    if (message.kind === "ask") {
      if (!answerByAskId.has(message.id)) unclaimedAskIds.push(message.id);
      continue;
    }
    if (message.kind !== "answer") continue;
    if (foldedAnswerIds.has(message.id)) continue;
    const payload = parseAnswer(message.content);
    if (!payload || payload.askMessageId !== undefined) continue;
    const askId = unclaimedAskIds.pop();
    if (askId === undefined) continue;
    answerByAskId.set(askId, message);
    foldedAnswerIds.add(message.id);
  }

  return { answerByAskId, foldedAnswerIds };
}
