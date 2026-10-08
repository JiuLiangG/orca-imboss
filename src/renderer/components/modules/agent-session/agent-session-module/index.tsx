import { t } from "@shared/l10n";
import type {
  AgentSessionViewEntry,
  AgentStreamEvent,
  AgentStreamPayload,
} from "@shared/types";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { cls } from "reactutils";
import { useApp } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import { EmployeeAvatar } from "../../../employee-avatar";
import { IconChevronDown } from "../../../icons";
import { Markdown } from "../../../markdown";
import "../../chat/thread.css";
import "./index.css";

export interface AgentSessionModuleProps {
  employeeId: number;
  chatId: number;
}

/** One reconstructed block of the currently streaming assistant message. */
interface LiveBlock {
  /** Stable React key within the live message. */
  key: string;
  kind: "text" | "thinking" | "tool";
  text: string;
  toolCallId?: string;
  name?: string;
  argsSummary?: string;
  argsDetail?: string;
  status?: "running" | "ok" | "error";
  /** Thinking block finished streaming (auto-folded). */
  done?: boolean;
}

interface LiveState {
  seq: number;
  finalized: boolean;
  blocks: Array<LiveBlock | undefined>;
}

/** Delay (ms) before re-reading the persisted session after a change event. */
const REFRESH_DELAY = 150;
/** Distance from the bottom (px) still considered "pinned" for auto-scroll. */
const PIN_THRESHOLD = 32;

/**
 * Read-only view of one `(employee, chat)` agent session.
 *
 * History comes from the persisted JSONL projection (`sessions:entries`);
 * live content is reconstructed from the bound token-level stream
 * (`agentSession:event`). Only the streaming assistant message is held in
 * memory — once it is persisted (`message_end`) the projection becomes the
 * source of truth and the live tail is dropped. There is intentionally no
 * system prompt, tool arguments or tool results.
 */
export function AgentSessionModule({
  employeeId,
  chatId,
}: AgentSessionModuleProps): React.JSX.Element {
  const { data, openedSessions } = useApp();
  const [entries, setEntries] = useState<AgentSessionViewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const liveRef = useRef<LiveState | null>(null);
  const liveSeqRef = useRef(0);
  // Any live mutation bumps the version so the ref-based live state re-renders.
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  const threadRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const refreshTimer = useRef<number | null>(null);
  const disposedRef = useRef(false);

  const session = openedSessions.find(
    (s) => s.employeeId === employeeId && s.chatId === chatId,
  );
  const employee = data.employees.items.find((e) => e.id === employeeId);
  const employeeName = employee?.name ?? t("Unnamed");
  const chatTitle = session?.chatTitle ?? t("Conversation");

  const loadEntries = useCallback(async (): Promise<void> => {
    // Snapshot before the await: if a new live message starts while the read is
    // in flight, keep it instead of clearing it (would drop streamed tokens).
    const liveAtRequest = liveRef.current;
    try {
      const next = await imb.sessions.entries(employeeId, chatId);
      if (disposedRef.current) return;
      setEntries(next);
      // The projection now contains any just-persisted message; drop the
      // tentative live tail so nothing is rendered twice.
      if (liveRef.current === liveAtRequest) liveRef.current = null;
      setError(null);
      bump();
    } catch (err) {
      if (disposedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [employeeId, chatId]);

  // Initial history load. `loading` only guards the first paint so background
  // refreshes never blank the thread.
  useEffect(() => {
    disposedRef.current = false;
    setLoading(true);
    void loadEntries().finally(() => {
      if (!disposedRef.current) setLoading(false);
    });
    return () => {
      disposedRef.current = true;
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [loadEntries]);

  const scheduleRefresh = useCallback((): void => {
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
    }
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void loadEntries();
    }, REFRESH_DELAY);
  }, [loadEntries]);

  // --- Live event application ------------------------------------------------
  const ensureLive = useCallback((): LiveState => {
    let state = liveRef.current;
    if (!state || state.finalized) {
      liveSeqRef.current += 1;
      state = { seq: liveSeqRef.current, finalized: false, blocks: [] };
      liveRef.current = state;
    }
    return state;
  }, []);

  const ensureBlock = useCallback(
    (state: LiveState, index: number, kind: LiveBlock["kind"]): LiveBlock => {
      let block = state.blocks[index];
      if (!block || block.kind !== kind) {
        block = { key: `${state.seq}:${index}`, kind, text: "" };
        state.blocks[index] = block;
      }
      return block;
    },
    [],
  );

  const applyMessageUpdate = useCallback(
    (event: Extract<AgentStreamEvent, { type: "message_update" }>): void => {
      // Only assistant messages stream, so the first delta implicitly opens a
      // new live message (or reopens one after the previous finalized).
      const state = ensureLive();
      const index = event.contentIndex ?? 0;
      switch (event.subType) {
        case "thinking_start":
          ensureBlock(state, index, "thinking");
          break;
        case "thinking_delta":
          ensureBlock(state, index, "thinking").text += event.delta ?? "";
          break;
        case "thinking_end":
          ensureBlock(state, index, "thinking").done = true;
          break;
        case "text_start":
          ensureBlock(state, index, "text");
          break;
        case "text_delta":
          ensureBlock(state, index, "text").text += event.delta ?? "";
          break;
        case "toolcall_start":
          ensureBlock(state, index, "tool");
          break;
        case "toolcall_end": {
          const block = ensureBlock(state, index, "tool");
          if (event.toolCallId !== undefined)
            block.toolCallId = event.toolCallId;
          if (event.toolName !== undefined) block.name = event.toolName;
          if (event.toolArgsSummary !== undefined) {
            block.argsSummary = event.toolArgsSummary;
          }
          if (event.toolArgsDetail !== undefined) {
            block.argsDetail = event.toolArgsDetail;
          }
          block.status = "running";
          break;
        }
        default:
          // text_end / toolcall_delta (arguments) / done / error: ignored.
          break;
      }
    },
    [ensureBlock, ensureLive],
  );

  /** Update a tool's status in both the live tail and the projected history. */
  const applyToolStatus = useCallback(
    (toolCallId: string, status: "running" | "ok" | "error"): void => {
      const live = liveRef.current;
      if (live) {
        const block = live.blocks.find(
          (b): b is LiveBlock =>
            b !== undefined && b.kind === "tool" && b.toolCallId === toolCallId,
        );
        if (block) block.status = status;
      }
      setEntries((prev) => {
        let changed = false;
        const next = prev.map((entry) => {
          if (
            entry.kind === "tool" &&
            entry.toolCallId === toolCallId &&
            entry.status !== status
          ) {
            changed = true;
            return { ...entry, status };
          }
          return entry;
        });
        return changed ? next : prev;
      });
    },
    [],
  );

  const handleEvent = useCallback(
    (payload: AgentStreamPayload): void => {
      if (payload.employeeId !== employeeId || payload.chatId !== chatId)
        return;
      const event = payload.event;
      switch (event.type) {
        case "message_update":
          applyMessageUpdate(event);
          bump();
          break;
        case "tool_execution_start":
          applyToolStatus(event.toolCallId, "running");
          if (event.toolName) {
            const live = liveRef.current;
            if (live) {
              const block = live.blocks.find(
                (b): b is LiveBlock =>
                  b !== undefined &&
                  b.kind === "tool" &&
                  b.toolCallId === event.toolCallId,
              );
              if (block && !block.name) block.name = event.toolName;
            }
          }
          bump();
          break;
        case "tool_execution_end":
          applyToolStatus(event.toolCallId, event.isError ? "error" : "ok");
          bump();
          break;
        case "message_end":
          if (liveRef.current) {
            liveRef.current.finalized = true;
            bump();
          }
          scheduleRefresh();
          break;
        case "agent_start":
        case "compaction_end":
        case "agent_end":
          scheduleRefresh();
          break;
        default:
          break;
      }
    },
    [employeeId, chatId, applyMessageUpdate, applyToolStatus, scheduleRefresh],
  );

  // Bind the session so its events reach this window, and subscribe once to the
  // global event stream (routing by key). Only the mounted view binds.
  useEffect(() => {
    void imb.agentSession.bind(employeeId, chatId);
    return () => {
      void imb.agentSession.unbind(employeeId, chatId);
    };
  }, [employeeId, chatId]);

  useEffect(() => {
    const off = imb.agentSession.onEvent(handleEvent);
    return off;
  }, [handleEvent]);

  // Auto-scroll to the newest content while the user is pinned to the bottom.
  useEffect(() => {
    const el = threadRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [entries, version, loading]);

  const handleScroll = useCallback((): void => {
    const el = threadRef.current;
    if (!el) return;
    pinnedRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD;
  }, []);

  const live = liveRef.current;
  const liveBlocks = live
    ? live.blocks.filter((b): b is LiveBlock => b !== undefined)
    : [];

  const content = (
    <>
      <div className="imb-chat-header">
        <div className="imb-chat-header-avatar">
          <EmployeeAvatar employeeId={employeeId} size={36} />
        </div>
        <div className="imb-session-heading">
          <div className="imb-chat-title">{employeeName}</div>
          <div className="imb-session-subtitle">{chatTitle}</div>
        </div>
      </div>
      <div
        className="imb-thread imb-session-thread"
        ref={threadRef}
        onScroll={handleScroll}
      >
        {!loading && entries.length === 0 && liveBlocks.length === 0 ? (
          <div className="imb-chat-empty-detail">
            {t("No session content yet")}
          </div>
        ) : (
          <>
            {entries.map((entry) => (
              <SessionEntry key={entry.id} entry={entry} />
            ))}
            {liveBlocks.map((block) => (
              <LiveBlockView key={block.key} block={block} />
            ))}
          </>
        )}
      </div>
      {error !== null && (
        <p className="imb-error-text imb-chat-error">{error}</p>
      )}
    </>
  );

  return <ModuleView content={content} />;
}

/** Render one projected history entry. */
function SessionEntry({
  entry,
}: {
  entry: AgentSessionViewEntry;
}): React.JSX.Element {
  switch (entry.kind) {
    case "user":
      return <div className="imb-session-user">{entry.text}</div>;
    case "text":
      return (
        <div className="imb-session-text">
          <Markdown content={entry.text} />
        </div>
      );
    case "thinking":
      return <ThinkingBlock text={entry.text} streaming={false} />;
    case "tool":
      return (
        <ToolBlock
          name={entry.name}
          status={entry.status}
          summary={entry.argsSummary}
          detail={entry.argsDetail}
        />
      );
    case "compaction":
      return <CompactionBlock summary={entry.summary} />;
  }
}

/** Render one reconstructed live block. */
function LiveBlockView({ block }: { block: LiveBlock }): React.JSX.Element {
  switch (block.kind) {
    case "text":
      return (
        <div className="imb-session-text">
          <Markdown content={block.text} />
        </div>
      );
    case "thinking":
      return <ThinkingBlock text={block.text} streaming={!block.done} />;
    case "tool":
      return (
        <ToolBlock
          name={block.name ?? t("Tool")}
          status={block.status ?? "running"}
          summary={block.argsSummary}
          detail={block.argsDetail}
        />
      );
  }
}

/**
 * Collapsible assistant reasoning. Auto-expands while streaming and folds once
 * the thinking block ends; a completed block starts folded and toggles on click.
 */
function ThinkingBlock({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(streaming);
  useEffect(() => {
    setOpen(streaming);
  }, [streaming]);

  return (
    <div className={cls("imb-session-thinking", open && "imb-is-open")}>
      <button
        type="button"
        className="imb-session-thinking-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <IconChevronDown className="imb-icon imb-sm" />
        <span>{streaming ? t("Thinking…") : t("Thinking")}</span>
      </button>
      {open && <div className="imb-session-thinking-body">{text}</div>}
    </div>
  );
}

/** A tool call: name, a compact argument summary, and expandable args detail. */
function ToolBlock({
  name,
  status,
  summary,
  detail,
}: {
  name: string;
  status: "running" | "ok" | "error";
  summary?: string;
  detail?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const expandable = detail !== undefined && detail.length > 0;
  const row = (
    <>
      <span className="imb-session-tool-dot" aria-hidden="true" />
      <span className="imb-session-tool-name">{name}</span>
      {summary !== undefined && summary.length > 0 && (
        <span className="imb-session-tool-args" title={summary}>
          {summary}
        </span>
      )}
      <span className="imb-session-tool-status">
        {status === "running"
          ? t("Running")
          : status === "error"
            ? t("Failed")
            : t("Done")}
      </span>
    </>
  );
  return (
    <div
      className={cls(
        "imb-session-tool",
        `imb-is-${status}`,
        expandable && "imb-is-expandable",
        open && "imb-is-open",
      )}
    >
      {expandable ? (
        <button
          type="button"
          className="imb-session-tool-head"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {row}
        </button>
      ) : (
        <div className="imb-session-tool-head">{row}</div>
      )}
      {expandable && open && (
        <pre className="imb-session-tool-detail">{detail}</pre>
      )}
    </div>
  );
}

/** A compaction marker with its summary. */
function CompactionBlock({ summary }: { summary: string }): React.JSX.Element {
  return (
    <div className="imb-session-compaction">
      <div className="imb-session-compaction-head">{t("Compacted")}</div>
      <div className="imb-session-compaction-body">
        <Markdown content={summary} />
      </div>
    </div>
  );
}
