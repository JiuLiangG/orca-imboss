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
      /**
       * A prompt delivered to the session by a human (composer, integrations,
       * cron job content). Internal wake prompts are `kind: "wake"` instead.
       */
      kind: "user";
      id: string;
      text: string;
    }
  | {
      /**
       * An internal "you have new messages" wake prompt.
       *
       * Never user-authored and never rendered as a user bubble: the view draws
       * it as a batch separator (one per batch of processed messages). The
       * original prompt text is intentionally not carried over.
       */
      kind: "wake";
      id: string;
      /**
       * Chat the wake points at (the `… in chat <id>` variant, used when the
       * assistant is woken in its root session for a task group chat).
       * Informational only — the view does not resolve a title for it.
       */
      targetChatId?: number;
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
      /**
       * A turn the boss interrupted. Drawn as a system separator where the aborted
       * turn was cut (backed by a Pi custom entry, so it survives a restart and is
       * never part of the model's context).
       */
      kind: "interrupted";
      id: string;
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
