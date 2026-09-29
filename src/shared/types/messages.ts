/**
 * Free-form message kind. The UI only special-cases `progress`; other kinds
 * (e.g. `text`, `report`, `chat`, `join_notice`) are routed through the generic
 * bubble. `report` is a free-form result summary (employee → assigner, or
 * assistant → boss for the final summary).
 */
export type MessageKind = string;

export type StepStatus = "done" | "busy";

/** One row of a progress card payload (kind = `progress`). */
export interface MessageStep {
  name: string;
  role: string;
  status: StepStatus;
}

/** Attachment metadata attached to a (user) message. */
export interface MessageAttachment {
  name: string;
  size: number;
  type: string;
}

/** Row of the `messages` table, ordered per chat by `created_at`. */
export interface Message {
  /** Global row id (monotonic; breaks same-second ties on ordering). */
  id: number;
  chatId: number;
  /** `null` when sent by the user or by the system. */
  senderEmployeeId: number | null;
  kind: MessageKind;
  content: string;
  /** Present when `kind` is `progress`. */
  steps: MessageStep[] | null;
  /** Present when the message carries attachments. */
  attachments: MessageAttachment[] | null;
  /** UNIX timestamp in seconds. */
  createdAt: number;
}

/** One hit from `messages:search` (FTS index or LIKE fallback). */
export interface MessageSearchResult {
  chatId: number;
  messageId: number;
  chatTitle: string;
  /** Content excerpt with the match wrapped in `«`/`»` markers. */
  snippet: string;
  /** UNIX timestamp in seconds. */
  createdAt: number;
}

/** Optional payload for `appendMessage` (all fields validated by the service). */
export interface AppendMessageOptions {
  kind?: MessageKind;
  steps?: MessageStep[];
  attachments?: MessageAttachment[];
}

/** Payload of the `chat:send` IPC (user → assistant placeholder pipeline). */
export interface SendChatPayload {
  chatId: number;
  content: string;
  attachments?: MessageAttachment[];
}
