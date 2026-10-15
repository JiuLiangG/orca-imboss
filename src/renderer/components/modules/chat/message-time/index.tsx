import "./index.css";

export interface MessageTimeProps {
  /** Exact send-time label; `null`/empty renders nothing. */
  label?: string | null;
}

/**
 * Hover-revealed exact send-time tag, shared by the message bubble and the
 * card kinds (ask/answer/progress/chat) so every non-ack message exposes its
 * precise timestamp the same way. The tag anchors to the nearest positioned
 * host (the bubble or card container), which each caller keeps
 * `position: relative`.
 */
export function MessageTime({
  label,
}: MessageTimeProps): React.JSX.Element | null {
  if (label == null || label.length === 0) return null;
  return <span className="imb-msg-time">{label}</span>;
}
