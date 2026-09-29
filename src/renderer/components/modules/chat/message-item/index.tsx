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
    default:
      return (
        <MessageBubble
          self={message.senderEmployeeId === null}
          content={message.content}
          attachments={message.attachments}
          avatar={
            <EmployeeAvatar employeeId={message.senderEmployeeId} size={34} />
          }
        />
      );
  }
}
