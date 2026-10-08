/**
 * Renderer-facing projection of a persisted `(employee, chat)` agent session.
 *
 * The raw Pi session JSONL holds full system prompts, tool arguments, tool
 * results, images and usage data. This projection is deliberately slim: only
 * the content the read-only session view renders crosses the IPC boundary
 * (see `readSessionView` in the main process).
 */
export type AgentSessionViewEntry =
  | {
      /** A user prompt delivered to the session (including wake prompts). */
      kind: "user";
      id: string;
      text: string;
    }
  | {
      /** Assistant free-form text. */
      kind: "text";
      id: string;
      text: string;
    }
  | {
      /** Assistant reasoning (thinking) block. */
      kind: "thinking";
      id: string;
      text: string;
    }
  | {
      /** A tool call; the name plus a compact argument summary (no results). */
      kind: "tool";
      id: string;
      /** Pi tool-call id; correlates live `tool_execution_*` stream events. */
      toolCallId?: string;
      name: string;
      /** One-line, capped human-readable argument summary. */
      argsSummary: string;
      /** Capped pretty-printed arguments JSON, when the call had arguments. */
      argsDetail?: string;
      status: "running" | "ok" | "error";
    }
  | {
      /** A context-compaction marker (summary text only). */
      kind: "compaction";
      id: string;
      summary: string;
    };

/** Full projected session returned by `sessions:entries`. */
export interface AgentSessionView {
  employeeId: number;
  chatId: number;
  entries: AgentSessionViewEntry[];
}
