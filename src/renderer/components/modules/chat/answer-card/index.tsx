import { t } from "@shared/l10n";
import type { Message } from "@shared/types";
import { cls } from "reactutils";
import { EmployeeAvatar } from "../../../employee-avatar";
import { MessageBubble } from "../message-bubble";
import "./index.css";

export interface AnswerCardProps {
  message: Message;
}

interface AnswerItem {
  questionId: string;
  selected?: string[];
  text?: string;
}

interface AnswerPayload {
  answers: AnswerItem[];
}

/**
 * Read-only answer card (kind=`answer`). Parses the message `content` as a
 * JSON answer set and renders each answer's question ref + chosen options +
 * free text. A parse failure or an empty set degrades to the generic bubble.
 */
export function AnswerCard({ message }: AnswerCardProps): React.JSX.Element {
  const self = message.senderEmployeeId === null;
  const payload = parseAnswer(message.content);

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

  return (
    <div className={cls("imb-msg", self ? "imb-self" : "imb-other")}>
      <EmployeeAvatar employeeId={message.senderEmployeeId} size={34} />
      <div className="imb-answer-card">
        <div className="imb-answer-card-title">{t("Answer")}</div>
        {payload.answers.map((a) => (
          <div className="imb-answer-item" key={a.questionId}>
            <div className="imb-answer-qid">{a.questionId}</div>
            {a.selected !== undefined && a.selected.length > 0 && (
              <div className="imb-answer-selected">{a.selected.join(", ")}</div>
            )}
            {a.text !== undefined && a.text.length > 0 && (
              <div className="imb-answer-text">{a.text}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Defensive parse of the answer payload; returns null on any invalid shape. */
function parseAnswer(content: string): AnswerPayload | null {
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
  return result.length > 0 ? { answers: result } : null;
}
