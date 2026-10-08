import { t } from "@shared/l10n";
import type { Message } from "@shared/types";
import { cls } from "reactutils";
import { EmployeeAvatar } from "../../../employee-avatar";
import { parseAnswer } from "../ask-answer";
import { MessageBubble } from "../message-bubble";
import "./index.css";

export interface AnswerCardProps {
  message: Message;
  /** Click handler for the sender avatar (opens the agent session). */
  onAvatarClick?: () => void;
}

/**
 * Read-only answer card (kind=`answer`). Parses the message `content` as a
 * JSON answer set and renders each answer's question ref + chosen options +
 * free text. A parse failure or an empty set degrades to the generic bubble.
 */
export function AnswerCard({
  message,
  onAvatarClick,
}: AnswerCardProps): React.JSX.Element {
  const self = message.senderEmployeeId === null;
  const payload = parseAnswer(message.content);

  if (!payload) {
    return (
      <MessageBubble
        self={self}
        messageId={message.id}
        content={message.content}
        attachments={message.attachments}
        attachmentsTotal={message.attachmentsTotal}
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

  return (
    <div className={cls("imb-msg", self ? "imb-self" : "imb-other")}>
      <EmployeeAvatar
        employeeId={message.senderEmployeeId}
        size={34}
        onClick={onAvatarClick}
      />
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
