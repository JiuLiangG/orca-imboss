import { t } from "@shared/l10n";
import type { Message } from "@shared/types";
import { useEffect, useMemo, useState } from "react";
import { cls } from "reactutils";
import {
  clearAskDraft,
  pruneAskDraft,
  readAskDraft,
  setAskDraftSelection,
  setAskDraftText,
} from "../../../../ask-draft";
import { EmployeeAvatar } from "../../../employee-avatar";
import { Markdown } from "../../../markdown";
import { type AnswerItem, parseAnswer } from "../ask-answer";
import { MessageBubble } from "../message-bubble";
import { MessageTime } from "../message-time";
import "./index.css";

export interface AskCardProps {
  message: Message;
  /** Read-only rendering: inputs are disabled and the submit button is hidden. */
  readonly?: boolean;
  /** Called after a successful answer so the chat thread can reload. */
  onAnswered: () => void;
  /**
   * The answer message folded into this card, when the question has already
   * been answered. Seeds the retained options/text and marks the card answered.
   */
  answer?: Message;
  /** Click handler for the sender avatar (opens the agent session). */
  onAvatarClick?: () => void;
  /** Resolve `@<id>` mentions in question/option text (non-interactive here). */
  resolveMention?: (id: number) => string | null;
  /** Exact send time, revealed on hover at the card's bottom-right corner. */
  timeLabel?: string | null;
}

interface AskQuestion {
  id: string;
  text: string;
  type?: "single" | "multiple" | "free";
  options?: string[];
}

interface AskPayload {
  questions: AskQuestion[];
}

interface AnswerDraft {
  questionId: string;
  selected?: string[];
  text?: string;
}

/**
 * Interactive inline ask card (kind=`ask`). Parses the message `content` as a
 * JSON question set, renders candidate options and/or free-form inputs per
 * question, and submits the answers via `messages:answer`. A parse failure or
 * an empty set degrades to the generic message bubble.
 */
export function AskCard({
  message,
  readonly = false,
  onAnswered,
  answer,
  onAvatarClick,
  resolveMention,
  timeLabel,
}: AskCardProps): React.JSX.Element {
  const self = message.senderEmployeeId === null;
  // Memoised so the question set keeps its identity across re-renders (the
  // draft reconciliation effect depends on it).
  const payload = useMemo(() => parseAsk(message.content), [message.content]);
  const persisted = useMemo(
    () => (answer ? parseAnswer(answer.content) : null),
    [answer],
  );
  // Unsubmitted input is written through to `ask-draft` on every edit: a page or
  // chat switch unmounts the whole module, so only that store survives.
  const [selectedByQuestion, setSelectedByQuestion] = useState<
    Record<string, string[]>
  >(() => {
    if (persisted) return seedSelected(persisted.answers);
    return seedDraftSelected(readAskDraft(message.id)?.selected);
  });
  const [textByQuestion, setTextByQuestion] = useState<Record<string, string>>(
    () => {
      if (persisted) return seedText(persisted.answers);
      return seedDraftText(readAskDraft(message.id)?.text);
    },
  );
  const [submitted, setSubmitted] = useState(persisted !== null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rehydrate when the folded answer arrives after mount (thread reload).
  useEffect(() => {
    if (!persisted) return;
    setSelectedByQuestion(seedSelected(persisted.answers));
    setTextByQuestion(seedText(persisted.answers));
    setSubmitted(true);
    // An answered card has no draft any more: a retained one would be a ghost
    // from the moment before the answer landed (e.g. a submit followed by a
    // reload that arrived before the store was cleared).
    clearAskDraft(message.id);
  }, [persisted, message.id]);

  // Drop retained answers to questions this payload no longer declares.
  useEffect(() => {
    if (!payload) return;
    pruneAskDraft(
      message.id,
      new Set(payload.questions.map((question) => question.id)),
    );
  }, [message.id, payload]);

  if (!payload) {
    return (
      <MessageBubble
        self={self}
        messageId={message.id}
        content={message.content}
        attachments={message.attachments}
        attachmentsTotal={message.attachmentsTotal}
        resolveMention={resolveMention}
        avatar={
          <EmployeeAvatar
            employeeId={message.senderEmployeeId}
            size={34}
            onClick={onAvatarClick}
          />
        }
      />
    );
  }

  /**
   * Record the chosen options of one question — in the card (instant feedback)
   * and in the retained draft (survives an unmount). No-ops once the card is
   * answered or read-only, mirroring the disabled inputs.
   */
  const applySelection = (questionId: string, selected: string[]): void => {
    if (submitted || readonly) return;
    setSelectedByQuestion((previous) => ({
      ...previous,
      [questionId]: selected,
    }));
    setAskDraftSelection(message.id, message.chatId, questionId, selected);
  };

  /** Record the free-form text of one question (card + retained draft). */
  const applyText = (questionId: string, text: string): void => {
    if (submitted || readonly) return;
    setTextByQuestion((previous) => ({ ...previous, [questionId]: text }));
    setAskDraftText(message.id, message.chatId, questionId, text);
  };

  const handleSubmit = async (): Promise<void> => {
    if (submitted || submitting) return;
    const answers = buildAnswers(
      payload.questions,
      selectedByQuestion,
      textByQuestion,
    );
    if (answers.length === 0) {
      setError(t("Please answer at least one question first."));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await imb.messages.answer(message.chatId, message.id, { answers });
      setSubmitted(true);
      // The answer is persisted now: the draft has become the answer message.
      clearAskDraft(message.id);
      onAnswered();
    } catch (err) {
      // Keep the draft: a failed submit must not lose what was typed.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cls("imb-msg", self ? "imb-self" : "imb-other")}>
      <EmployeeAvatar
        employeeId={message.senderEmployeeId}
        size={34}
        onClick={onAvatarClick}
      />
      <div
        className={cls("imb-ask-card", submitted && "imb-ask-card-submitted")}
      >
        <div className="imb-ask-card-title">{t("Question")}</div>
        {payload.questions.map((q) => (
          <div className="imb-ask-question" key={q.id}>
            <div className="imb-ask-q-text">
              <Markdown
                content={q.text}
                inline
                resolveMention={resolveMention}
              />
            </div>
            {isFreeForm(q) ? (
              <textarea
                className="imb-ask-free"
                value={textByQuestion[q.id] ?? ""}
                disabled={submitted || readonly}
                onChange={(e) => applyText(q.id, e.target.value)}
                placeholder={t("Type your answer")}
              />
            ) : q.type === "single" ? (
              <div className="imb-ask-options">
                {q.options!.map((opt) => (
                  <label className="imb-ask-option" key={opt}>
                    <input
                      type="radio"
                      name={`imb-${message.id}-q-${q.id}`}
                      checked={selectedByQuestion[q.id]?.includes(opt) ?? false}
                      disabled={submitted || readonly}
                      onChange={() => {
                        applySelection(q.id, [opt]);
                        applyText(q.id, "");
                      }}
                    />
                    <span>
                      <Markdown
                        content={opt}
                        inline
                        resolveMention={resolveMention}
                      />
                    </span>
                  </label>
                ))}
                <input
                  className="imb-ask-other"
                  value={textByQuestion[q.id] ?? ""}
                  disabled={submitted || readonly}
                  onChange={(e) => {
                    applyText(q.id, e.target.value);
                    applySelection(q.id, []);
                  }}
                  placeholder={t("Other (type a free-form answer)")}
                />
              </div>
            ) : (
              <div className="imb-ask-options">
                {q.options!.map((opt) => (
                  <label className="imb-ask-option" key={opt}>
                    <input
                      type="checkbox"
                      checked={selectedByQuestion[q.id]?.includes(opt) ?? false}
                      disabled={submitted || readonly}
                      onChange={() => {
                        const current = selectedByQuestion[q.id] ?? [];
                        applySelection(
                          q.id,
                          current.includes(opt)
                            ? current.filter((option) => option !== opt)
                            : [...current, opt],
                        );
                      }}
                    />
                    <span>
                      <Markdown
                        content={opt}
                        inline
                        resolveMention={resolveMention}
                      />
                    </span>
                  </label>
                ))}
                <input
                  className="imb-ask-other"
                  value={textByQuestion[q.id] ?? ""}
                  disabled={submitted || readonly}
                  onChange={(e) => applyText(q.id, e.target.value)}
                  placeholder={t("Other (type a free-form answer)")}
                />
              </div>
            )}
          </div>
        ))}
        {!readonly &&
          (submitted ? (
            <div className="imb-ask-submitted">{t("Answered")}</div>
          ) : (
            <button
              type="button"
              className="imb-ask-submit"
              disabled={submitting}
              onClick={() => void handleSubmit()}
            >
              {t("Submit answer")}
            </button>
          ))}
        {!readonly && error !== null && (
          <div className="imb-ask-error">{error}</div>
        )}
        <MessageTime label={timeLabel} />
      </div>
    </div>
  );
}

/** Defensive parse of the ask payload; returns null on any invalid shape. */
function parseAsk(content: string): AskPayload | null {
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
  const questions = record["questions"];
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const result: AskQuestion[] = [];
  for (const item of questions) {
    if (typeof item !== "object" || item === null) continue;
    const q = item as Record<string, unknown>;
    if (typeof q["id"] !== "string" || q["id"].length === 0) continue;
    if (typeof q["text"] !== "string") continue;
    const type = q["type"];
    const options = q["options"];
    result.push({
      id: q["id"],
      text: q["text"],
      type:
        type === "single" || type === "multiple" || type === "free"
          ? type
          : undefined,
      options: Array.isArray(options)
        ? options.filter((o): o is string => typeof o === "string")
        : undefined,
    });
  }
  return result.length > 0 ? { questions: result } : null;
}

/** A question is free-form when it declares `free` or provides no candidates. */
function isFreeForm(q: AskQuestion): boolean {
  return q.type === "free" || !q.options || q.options.length === 0;
}

/** Seed the selected-option state from a persisted answer's items. */
function seedSelected(answers: AnswerItem[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const item of answers) {
    if (item.selected !== undefined && item.selected.length > 0) {
      result[item.questionId] = [...item.selected];
    }
  }
  return result;
}

/** Seed the free-text state from a persisted answer's items. */
function seedText(answers: AnswerItem[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of answers) {
    if (item.text !== undefined && item.text.length > 0) {
      result[item.questionId] = item.text;
    }
  }
  return result;
}

/** Seed the free-text state from a retained draft (defensive copies). */
function seedDraftText(
  text: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [questionId, value] of Object.entries(text ?? {})) {
    if (value.length > 0) result[questionId] = value;
  }
  return result;
}

/** Seed the selected-option state from a retained draft (defensive copies). */
function seedDraftSelected(
  selected: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [questionId, options] of Object.entries(selected ?? {})) {
    if (options.length > 0) result[questionId] = [...options];
  }
  return result;
}

/** Build the `{ answers: [...] }` payload from the current UI state. */
function buildAnswers(
  questions: AskQuestion[],
  selectedByQuestion: Record<string, string[]>,
  textByQuestion: Record<string, string>,
): AnswerDraft[] {
  const answers: AnswerDraft[] = [];
  for (const q of questions) {
    const free = (textByQuestion[q.id] ?? "").trim();
    const selected = selectedByQuestion[q.id] ?? [];
    if (isFreeForm(q)) {
      if (free) answers.push({ questionId: q.id, text: free });
      continue;
    }
    if (q.type === "single") {
      if (selected.length > 0) {
        answers.push({ questionId: q.id, selected });
      } else if (free) {
        answers.push({ questionId: q.id, text: free });
      }
      continue;
    }
    const draft: AnswerDraft = { questionId: q.id };
    if (selected.length > 0) draft.selected = selected;
    if (free) draft.text = free;
    if (selected.length > 0 || free) answers.push(draft);
  }
  return answers;
}
