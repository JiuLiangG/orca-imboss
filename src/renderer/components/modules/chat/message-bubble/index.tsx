import type { MessageAttachment } from "@shared/types";
import { cls } from "reactutils";
import { IconFile } from "../../../icons";
import "./index.css";

export interface MessageBubbleProps {
  /** `true` = user message (right-aligned, green bubble). */
  self: boolean;
  content: string;
  attachments: MessageAttachment[] | null;
  /** Avatar node (left side for other-messages, right side for self). */
  avatar: React.ReactNode;
}

/** Chat message bubble (`.msg` + `.bubble`) with optional attachment chips. */
export function MessageBubble({
  self,
  content,
  attachments,
  avatar,
}: MessageBubbleProps): React.JSX.Element {
  const hasAttachments = attachments !== null && attachments.length > 0;
  return (
    <div className={cls("imb-msg", self ? "imb-self" : "imb-other")}>
      {avatar}
      <div className="imb-bubble">
        {hasAttachments && (
          <div className="imb-bubble-attachments">
            {attachments!.map((attachment) => (
              <span
                key={`${attachment.name}-${attachment.size}`}
                className="imb-bubble-chip"
              >
                <IconFile className="imb-icon imb-sm" />
                <span className="imb-bubble-chip-name">{attachment.name}</span>
                <span className="imb-bubble-chip-size">
                  {formatSize(attachment.size)}
                </span>
              </span>
            ))}
          </div>
        )}
        {content.length > 0 && (
          <span className="imb-bubble-text">{content}</span>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
