import { t } from "@shared/l10n";
import type { Message } from "@shared/types";
import { useState } from "react";
import { cls } from "reactutils";
import { EmployeeAvatar } from "../../../employee-avatar";
import { MessageBubble } from "../message-bubble";
import "./index.css";

export interface AskCardProps {
  message: Message;
  /** Read-only rendering: inputs are disabled and the submit button is hidden. */
  readonly?: boolean;
  /** Called after a successful answer so the chat thread can reload. */
  onAnswered: () => void;
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
}: AskCardProps): React.JSX.Element {
  const self = message.senderEmployeeId === null;
  const payload = parseAsk(message.content);
  const [selectedByQuestion, setSelectedByQuestion] = useState<
    Record<string, string[]>
  >({});
  const [textByQuestion, setTextByQuestion] = useState<Record<string, string>>(
    {},
  );
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!payload) {
    return (
      <MessageBubble
        self={self}
        content={message.content}
        attachments={message.attachments}
        avatar={
          <EmployeeAvatar employeeId={message.senderEmployeeId} size={34} />
        }
      />
    );
  }

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
      onAnswered();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cls("imb-msg", self ? "imb-self" : "imb-other")}>
      <EmployeeAvatar employeeId={message.senderEmployeeId} size={34} />
      <div className="imb-ask-card">
        <div className="imb-ask-card-title">{t("Question")}</div>
        {payload.questions.map((q) => (
          <div className="imb-ask-question" key={q.id}>
            <div className="imb-ask-q-text">{q.text}</div>
            {isFreeForm(q) ? (
              <textarea
                className="imb-ask-free"
                value={textByQuestion[q.id] ?? ""}
                disabled={submitted || readonly}
                onChange={(e) =>
                  setTextByQuestion((p) => ({ ...p, [q.id]: e.target.value }))
                }
                placeholder={t("Type your answer")}
              />
            ) : q.type === "single" ? (
              <div className="imb-ask-options">
                {q.options!.map((opt) => (
                  <label className="imb-ask-option" key={opt}>
                    <input
                      type="radio"
                      name={`imb-q-${q.id}`}
                      checked={selectedByQuestion[q.id]?.includes(opt) ?? false}
                      disabled={submitted || readonly}
                      onChange={() => {
                        setSelectedByQuestion((p) => ({ ...p, [q.id]: [opt] }));
                        setTextByQuestion((p) => ({ ...p, [q.id]: "" }));
                      }}
                    />
                    <span>{opt}</span>
                  </label>
                ))}
                <input
                  className="imb-ask-other"
                  value={textByQuestion[q.id] ?? ""}
                  disabled={submitted || readonly}
                  onChange={(e) => {
                    setTextByQuestion((p) => ({
                      ...p,
                      [q.id]: e.target.value,
                    }));
                    setSelectedByQuestion((p) => ({ ...p, [q.id]: [] }));
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
                      onChange={() =>
                        setSelectedByQuestion((p) => {
                          const cur = p[q.id] ?? [];
                          const next = cur.includes(opt)
                            ? cur.filter((x) => x !== opt)
                            : [...cur, opt];
                          return { ...p, [q.id]: next };
                        })
                      }
                    />
                    <span>{opt}</span>
                  </label>
                ))}
                <input
                  className="imb-ask-other"
                  value={textByQuestion[q.id] ?? ""}
                  disabled={submitted || readonly}
                  onChange={(e) =>
                    setTextByQuestion((p) => ({ ...p, [q.id]: e.target.value }))
                  }
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
