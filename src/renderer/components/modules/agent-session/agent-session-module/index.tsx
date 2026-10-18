import { t } from "@shared/l10n";
import type {
  AgentSessionViewEntry,
  AgentStreamEvent,
  AgentStreamPayload,
} from "@shared/types";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { cls } from "reactutils";
import { useApp } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import { EmployeeAvatar } from "../../../employee-avatar";
import { IconButton } from "../../../icon-button";
import { IconChevronDown, IconChevronUp } from "../../../icons";
import { Markdown } from "../../../markdown";
import { useMentionResolver } from "../../../markdown/use-mention";
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
/** Gap (px) kept between the viewport top and a divider a jump lands on. */
const JUMP_TOP_GAP = 16;
/** Scroll-offset tolerance (px) used to decide which divider is "nearest". */
const JUMP_EPSILON = 1;
/** Clamp a content-space scroll offset to the thread's reachable range. */
function clampScrollTop(top: number, maxScroll: number): number {
  return Math.min(Math.max(top, 0), maxScroll);
}

interface SessionScroll {
  scrollTop: number;
  pinned: boolean;
}
const sessionScrollStore = new Map<string, SessionScroll>();

/** Measured jump anchors (one per rendered wake divider). */
interface JumpAnchors {
  /** `scrollHeight` the measurement belongs to; the cache key. */
  scrollHeight: number;
  /** `scrollTop` values that put each divider at the top anchor line. */
  tops: number[];
}

/** Which jump buttons can do something at the current scroll position. */
interface JumpAvailability {
  prev: boolean;
  next: boolean;
}
const NO_JUMPS: JumpAvailability = { prev: false, next: false };

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
  const { data, openedItems } = useApp();
  const [entries, setEntries] = useState<AgentSessionViewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const liveRef = useRef<LiveState | null>(null);
  const liveSeqRef = useRef(0);
  // Any live mutation bumps the version so the ref-based live state re-renders.
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  const sessionKeyStr = `${employeeId}/${chatId}`;
  const threadRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  /** Cached jump anchors; re-measured when `scrollHeight` moves. */
  const anchorsRef = useRef<JumpAnchors | null>(null);
  const [jump, setJump] = useState<JumpAvailability>(NO_JUMPS);
  /** Mirror of `jump` so scroll handling can compare without re-rendering. */
  const jumpRef = useRef<JumpAvailability>(NO_JUMPS);
  const restoreScrollRef = useRef<{ key: string; scrollTop: number } | null>(
    null,
  );
  const refreshTimer = useRef<number | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    const saved = sessionScrollStore.get(sessionKeyStr);
    pinnedRef.current = saved ? saved.pinned : true;
    restoreScrollRef.current =
      saved && !saved.pinned
        ? { key: sessionKeyStr, scrollTop: saved.scrollTop }
        : null;
  }, [sessionKeyStr]);

  const sessionItem = openedItems.find(
    (item) =>
      item.kind === "session" &&
      item.employeeId === employeeId &&
      item.chatId === chatId,
  );
  const session = sessionItem?.kind === "session" ? sessionItem : null;
  const employee = data.employees.items.find((e) => e.id === employeeId);
  const employeeName = employee?.name ?? t("Unnamed");
  const chatTitle = session?.chatTitle ?? t("Conversation");
  // The transcript shows the raw `@<id>` text the model read; render names but
  // keep it non-interactive (this session's chat may not be where the mentioned
  // employee actually works).
  const { resolveMention } = useMentionResolver(chatId, false);

  const loadEntries = useCallback(async (): Promise<void> => {
    // Snapshot before the await: if a new live message starts while the read is
    // in flight, keep it instead of clearing it (would drop streamed tokens).
    const liveAtRequest = liveRef.current;
    try {
      const next = await imb.sessions.entries(employeeId, chatId);
      if (disposedRef.current) return;
      setEntries(next);
      // The projection now contains every persisted message, so a live tail
      // that already ended (`message_end`) is a duplicate and is dropped. A
      // tail that is still streaming is *not* in the projection yet, so it is
      // kept — dropping it would erase already-streamed blocks until the next
      // delta recreated them. (Refreshes can land mid-stream, e.g. one
      // scheduled by `turn_start`.)
      const live = liveRef.current;
      if (live === liveAtRequest && live?.finalized) liveRef.current = null;
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
        case "turn_start":
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

  // --- Jump to previous / next "new message" divider -------------------------
  /**
   * Measure the scroll position of every rendered wake divider, in the scroll
   * container's content space.
   *
   * Two deliberate choices:
   * - Position comes from rects relative to the thread, **not** `offsetTop`:
   *   `.imb-app` is `position: relative`, so a divider's `offsetParent` is not
   *   the thread and its `offsetTop` carries the header/titlebar offset.
   * - Cached by `scrollHeight`, which changes whenever anything above a divider
   *   resizes (a message streamed, a thinking block toggled, an image loaded).
   *
   * `force` re-measures even when `scrollHeight` is unchanged; the click handler
   * always passes it so a jump can never use a stale measurement.
   */
  const readAnchors = useCallback((force = false): JumpAnchors | null => {
    const el = threadRef.current;
    if (el === null) return null;
    const cached = anchorsRef.current;
    if (!force && cached !== null && cached.scrollHeight === el.scrollHeight) {
      return cached;
    }
    const threadRect = el.getBoundingClientRect();
    const tops: number[] = [];
    el.querySelectorAll<HTMLElement>("[data-session-divider]").forEach(
      (node) => {
        const rect = node.getBoundingClientRect();
        tops.push(rect.top - threadRect.top + el.scrollTop - JUMP_TOP_GAP);
      },
    );
    const measured: JumpAnchors = { scrollHeight: el.scrollHeight, tops };
    anchorsRef.current = measured;
    return measured;
  }, []);

  /**
   * Which jump buttons can do something from the current scroll position?
   *
   * Each direction is actionable when it can move the view at all:
   * - "previous" = a divider above the viewport's top anchor line, **or** any
   *   room above (`scrollTop > 0`) — pressing it again then goes to the very
   *   top of the transcript;
   * - "next" = a divider below it, **or** any room below — pressing it again
   *   then goes to the very bottom, including while pinned/following.
   * Only a direction with nowhere left to go is disabled.
   *
   * Divider targets are clamped to the reachable range, so a divider that cannot
   * be brought to the anchor line (it is closer to the end than one viewport)
   * never leaves a button enabled that could not move the view.
   */
  const computeJump = useCallback((): JumpAvailability => {
    const el = threadRef.current;
    const anchors = readAnchors();
    if (el === null || anchors === null) return NO_JUMPS;
    const scrollTop = el.scrollTop;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    let hasPrev = false;
    let hasNext = false;
    for (const raw of anchors.tops) {
      const top = clampScrollTop(raw, maxScroll);
      if (top < scrollTop - JUMP_EPSILON) hasPrev = true;
      else if (top > scrollTop + JUMP_EPSILON) hasNext = true;
    }
    return {
      prev: hasPrev || scrollTop > JUMP_EPSILON,
      next: hasNext || maxScroll - scrollTop > JUMP_EPSILON,
    };
  }, [readAnchors]);

  /** Recompute availability; re-render only when it actually changed. */
  const syncJump = useCallback((): void => {
    const next = computeJump();
    const current = jumpRef.current;
    if (current.prev === next.prev && current.next === next.next) return;
    jumpRef.current = next;
    setJump(next);
  }, [computeJump]);

  /** Scroll to the nearest "new message" divider, or to the very top/bottom. */
  const jumpTo = useCallback(
    (direction: "prev" | "next"): void => {
      const el = threadRef.current;
      const anchors = readAnchors(true);
      if (el === null || anchors === null) return;
      const scrollTop = el.scrollTop;
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      const targets = anchors.tops.map((raw) => clampScrollTop(raw, maxScroll));
      const nearest =
        direction === "next"
          ? targets.find((top) => top > scrollTop + JUMP_EPSILON)
          : targets.findLast((top) => top < scrollTop - JUMP_EPSILON);
      // No divider left in that direction: the same button keeps going to the
      // very end of the transcript (top for "previous", bottom for "next").
      // Those edges get no `JUMP_TOP_GAP` — that gap is divider alignment only.
      const target = nearest ?? (direction === "next" ? maxScroll : 0);
      // Already there (the button should be disabled in that case): do nothing
      // rather than start a pointless scroll.
      if (Math.abs(target - scrollTop) <= JUMP_EPSILON) return;
      // Following the live tail must not fight the jump: the follow effect runs
      // on every streamed delta, so `pinned` is cleared *before* scrolling and
      // the stored position is made to agree with it. Nothing re-pins manually:
      // when the jump lands at the bottom, `handleScroll` restores `pinned` from
      // the real position, which is exactly the desired behaviour.
      pinnedRef.current = false;
      sessionScrollStore.set(sessionKeyStr, { scrollTop, pinned: false });
      // `scrollTo` on the thread itself — never `scrollIntoView`, which would
      // also scroll ancestors.
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      el.scrollTo({
        top: target,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    },
    [readAnchors, sessionKeyStr],
  );

  // Re-measure when the projected content changes (dividers added/removed) and
  // seed the button state. Pure scroll-position changes are handled by
  // `handleScroll`, which every programmatic scroll also triggers.
  useLayoutEffect(() => {
    readAnchors(true);
    syncJump();
  }, [entries, loading, readAnchors, syncJump]);

  // Auto-scroll to the newest content while pinned, or restore saved scroll position.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const restore = restoreScrollRef.current;
    if (restore && restore.key === sessionKeyStr && !loading) {
      el.scrollTop = restore.scrollTop;
      restoreScrollRef.current = null;
      return;
    }
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [entries, version, loading, sessionKeyStr]);

  const handleScroll = useCallback((): void => {
    const el = threadRef.current;
    if (!el) return;
    const pinned =
      el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD;
    pinnedRef.current = pinned;
    sessionScrollStore.set(sessionKeyStr, {
      scrollTop: el.scrollTop,
      pinned,
    });
    syncJump();
  }, [sessionKeyStr, syncJump]);

  const live = liveRef.current;
  const liveBlocks = live
    ? live.blocks.filter((b): b is LiveBlock => b !== undefined)
    : [];

  // One divider per wake entry, minus a leading one (a batch boundary above the
  // first entry has nothing to separate, so `SessionEntry` skips it). Derived
  // from the projection, never from the DOM.
  const dividerCount = useMemo(() => {
    const wakes = entries.filter((entry) => entry.kind === "wake").length;
    return entries[0]?.kind === "wake" ? wakes - 1 : wakes;
  }, [entries]);

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
        className={cls(
          "imb-thread imb-session-thread",
          dividerCount > 0 && "imb-has-jumps",
        )}
        ref={threadRef}
        onScroll={handleScroll}
      >
        {!loading && entries.length === 0 && liveBlocks.length === 0 ? (
          <div className="imb-chat-empty-detail">
            {t("No session content yet")}
          </div>
        ) : (
          <>
            {entries.map((entry, index) => (
              <SessionEntry
                key={entry.id}
                entry={entry}
                first={index === 0}
                resolveMention={resolveMention}
              />
            ))}
            {liveBlocks.map((block) => (
              <LiveBlockView
                key={block.key}
                block={block}
                resolveMention={resolveMention}
              />
            ))}
          </>
        )}
      </div>
      {dividerCount > 0 && (
        <SessionJumpButtons availability={jump} onJump={jumpTo} />
      )}
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
  first,
  resolveMention,
}: {
  entry: AgentSessionViewEntry;
  /** True for the first rendered entry (some markers are skipped there). */
  first: boolean;
  resolveMention: (id: number) => string | null;
}): React.JSX.Element | null {
  switch (entry.kind) {
    case "wake":
      // A batch boundary above the first entry has nothing to separate.
      return first ? null : <SessionDivider />;
    case "user":
      return <div className="imb-session-user">{entry.text}</div>;
    case "text":
      return (
        <div className="imb-session-text">
          <Markdown content={entry.text} resolveMention={resolveMention} />
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
      return (
        <CompactionBlock
          summary={entry.summary}
          resolveMention={resolveMention}
        />
      );
  }
}

/**
 * Batch separator: a muted line with a centered label, drawn where an internal
 * "you have new messages" wake prompt sits in the session. One divider per
 * batch of processed messages (see `session-view.ts`).
 *
 * `data-session-divider` is the jump-anchor hook read by `readAnchors`
 * (`.imb-session-jumps` buttons); it is not used for styling.
 */
function SessionDivider(): React.JSX.Element {
  const label = t("New messages");
  return (
    <div
      className="imb-session-divider"
      role="separator"
      aria-label={label}
      data-session-divider=""
    >
      <span className="imb-session-divider-label">{label}</span>
    </div>
  );
}

/**
 * Floating "previous / next new message" control, fixed to the bottom-right of
 * the content pane (this view has no composer, and it is portaled into
 * `.imb-contentpane`, which is flush with the window edge).
 *
 * The up arrow sits above the down arrow. Each button first walks the wake
 * dividers, and once there is none left in that direction it keeps going to the
 * very top / bottom of the transcript. A direction is only disabled when the
 * view is already at that edge and no divider remains; the whole control is
 * only rendered when the session has at least one divider.
 */
function SessionJumpButtons({
  availability,
  onJump,
}: {
  availability: JumpAvailability;
  onJump: (direction: "prev" | "next") => void;
}): React.JSX.Element {
  return (
    <div className="imb-session-jumps">
      <IconButton
        className="imb-session-jump"
        label={t("Previous new message")}
        size={16}
        boxSize={32}
        disabled={!availability.prev}
        onClick={() => onJump("prev")}
      >
        <IconChevronUp />
      </IconButton>
      <IconButton
        className="imb-session-jump"
        label={t("Next new message")}
        size={16}
        boxSize={32}
        disabled={!availability.next}
        onClick={() => onJump("next")}
      >
        <IconChevronDown />
      </IconButton>
    </div>
  );
}

/** Render one reconstructed live block. */
function LiveBlockView({
  block,
  resolveMention,
}: {
  block: LiveBlock;
  resolveMention: (id: number) => string | null;
}): React.JSX.Element {
  switch (block.kind) {
    case "text":
      return (
        <div className="imb-session-text">
          <Markdown content={block.text} resolveMention={resolveMention} />
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
function CompactionBlock({
  summary,
  resolveMention,
}: {
  summary: string;
  resolveMention: (id: number) => string | null;
}): React.JSX.Element {
  return (
    <div className="imb-session-compaction">
      <div className="imb-session-compaction-head">{t("Compacted")}</div>
      <div className="imb-session-compaction-body">
        <Markdown content={summary} resolveMention={resolveMention} />
      </div>
    </div>
  );
}
