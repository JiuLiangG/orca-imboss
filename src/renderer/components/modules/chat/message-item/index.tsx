import { t } from "@shared/l10n";
import type { Message } from "@shared/types";
import { EmployeeAvatar } from "../../../employee-avatar";
import { AnswerCard } from "../answer-card";
import { AskCard } from "../ask-card";
import { ChatCard } from "../chat-card";
import { MessageBubble } from "../message-bubble";
import { ProgressCard } from "../progress-card";

export interface MessageItemProps {
  message: Message;
  /** Read-only rendering (group-chat view): interactive cards are static. */
  readonly?: boolean;
  /** Called after a successful ask-card answer (interactive mode only). */
  onAnswered?: () => void;
}

/**
 * Renders one message according to its `kind`, shared by the interactive chat
 * module and the read-only group-chat module so the two views never drift.
 */
export function MessageItem({
  message,
  readonly = false,
  onAnswered,
}: MessageItemProps): React.JSX.Element {
  switch (message.kind) {
    case "ask":
      return (
        <AskCard
          message={message}
          readonly={readonly}
          onAnswered={onAnswered ?? (() => undefined)}
        />
      );
    case "answer":
      return <AnswerCard message={message} />;
    case "progress":
      return (
        <div className="imb-msg imb-other">
          <EmployeeAvatar
            employeeId={message.senderEmployeeId ?? 0}
            size={34}
          />
          <ProgressCard title={message.content} steps={message.steps ?? []} />
        </div>
      );
    case "chat":
      return <ChatCard message={message} />;
    case "ack":
      // App-generated receipt: stored content is empty, the label is localized
      // at render time so it follows locale switches.
      return (
        <MessageBubble
          self={false}
          messageId={message.id}
          content={t("ACK")}
          attachments={null}
          attachmentsTotal={null}
          avatar={
            <EmployeeAvatar employeeId={message.senderEmployeeId} size={34} />
          }
        />
      );
    default:
      return (
        <MessageBubble
          self={message.senderEmployeeId === null}
          messageId={message.id}
          content={message.content}
          attachments={message.attachments}
          attachmentsTotal={message.attachmentsTotal}
          markdown={message.kind === "text" || message.kind === "report"}
          avatar={
            <EmployeeAvatar employeeId={message.senderEmployeeId} size={34} />
          }
        />
      );
  }
}
