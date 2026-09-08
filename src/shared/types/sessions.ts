/** Row of the `sessions` table (one Pi session per employee per chat). */
export interface EmployeeSession {
  employeeId: number;
  chatId: number;
  session: string;
  /** Per-(employee, chat) read cursor: the highest message id the agent has read. */
  lastReadMessageId: number;
}

export interface AgentSessionContext {
  employeeId: number;
  chatId: number;
}

export interface AgentPromptResult {
  /** True when a real agent turn ran (a model was configured and answered). */
  replied: boolean;
  /** Final assistant reply text (all text content of the last `turn_end`). */
  replyText?: string;
}

export interface DeliverOptions {
  /**
   * When set, persist the agent's reply as a message from this employee
   * (`messages.appendMessage(chatId, replyAs, replyText)`). `null` disables
   * auto-persist (the agent is expected to post via `send_message` itself).
   */
  persistReplyAs?: number | null;
  /** Fallback reply text persisted when the run does not produce a reply. */
  fallbackReply?: string | null;
}
