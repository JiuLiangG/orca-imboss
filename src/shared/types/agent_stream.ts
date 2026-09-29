/** Reason a session compaction was triggered (mirrors the Pi session event). */
export type CompactionReason = "manual" | "threshold" | "overflow";

/**
 * Minimal, structured-cloneable projection of the Pi `AgentSessionEvent`s the
 * renderer needs.
 *
 * Raw events are never forwarded: they carry full message objects / tool
 * results and `message_update` fires per streamed token. `message_update` is
 * reduced to its sub-type plus the delta; every other event is metadata only.
 */
export type AgentStreamEvent =
  | {
      type: "message_update";
      /** `assistantMessageEvent.type`, e.g. `text_delta` / `thinking_delta`. */
      subType: string;
      delta?: string;
      contentIndex?: number;
    }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      isError: boolean;
    }
  | { type: "agent_start" }
  | { type: "agent_end"; willRetry: boolean }
  | { type: "message_start" }
  | { type: "message_end" }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "compaction_start"; reason: CompactionReason }
  | {
      type: "compaction_end";
      reason: CompactionReason;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | { type: "error"; message: string };

/** Envelope pushed to a bound renderer over `agentSession:event`. */
export interface AgentStreamPayload {
  employeeId: number;
  chatId: number;
  event: AgentStreamEvent;
}
