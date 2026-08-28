import type { MessageAttachment } from "../../../../../../shared/types";
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
    <div className={`imb-msg${self ? " imb-self" : " imb-other"}`}>
      <span className="imb-avatar">{avatar}</span>
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
        {content.length > 0 && <span className="imb-bubble-text">{content}</span>}
      </div>
    </div>
  );
}

/** Assistant avatar mark (green circle face, prototype `assistantAvatar`). */
export function AssistantMark({
  size = 34,
}: {
  size?: number;
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="18" fill="#07C160" />
      <circle cx="13" cy="16" r="2.5" fill="white" />
      <circle cx="23" cy="16" r="2.5" fill="white" />
      <circle cx="13" cy="15.5" r="1" fill="#07C160" />
      <circle cx="23" cy="15.5" r="1" fill="#07C160" />
      <path
        d="M13 22.5C13 22.5 15.5 25 18 25C20.5 25 23 22.5 23 22.5"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="29" cy="8" r="2.5" fill="white" opacity="0.7" />
      <circle cx="7" cy="9" r="1.5" fill="white" opacity="0.5" />
    </svg>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
