import { t } from "@shared/l10n";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { cls } from "reactutils";
import { useEscapeKey } from "../../../../hooks/use-escape-key";
import { IconList } from "../../../icons";
import "./index.css";

/**
 * Distance (px) between the thread's top edge and the message a jump lands on.
 * Matches the agent-session jump buttons (`JUMP_TOP_GAP`) so both views stop on
 * the same line.
 */
export const MY_JUMP_TOP_GAP = 16;

/** Delay (ms) before collapsing after the pointer / focus leaves the control. */
const CLOSE_DELAY = 150;

/**
 * Window (ms) during which a focus event is ignored after Escape moved the focus
 * back to the button — long enough to cover that focus, short enough that a real
 * Tab / click right afterwards still opens the list.
 */
const FOCUS_SUPPRESS_MS = 400;

/** Stable id for `aria-controls` (one control per chat module). */
const PANEL_ID = "imb-my-jump-panel";

/** One entry of the list: a message the boss wrote, flattened to one line. */
export interface MyMessageEntry {
  /** Global message id; the row in the thread carries `data-message-id`. */
  id: number;
  /** Whitespace-collapsed text, used for the single-line row and its tooltip. */
  text: string;
}

export interface MyMessageJumpProps {
  /**
   * The thread's scroll container (`threadRef` of the module). Used to read the
   * rows' positions and to pick the "current" entry — never to scroll: the
   * module owns that (it also maintains the pinned/auto-follow state).
   */
  threadRef: RefObject<HTMLDivElement | null>;
  /** The boss's messages, oldest first (transcript order). */
  entries: MyMessageEntry[];
  /** Scroll to a message (the module does the scrolling and the landing flash). */
  onSelect: (messageId: number) => void;
}

/**
 * Floating bottom-right control that expands on hover / focus into a one-line
 * list of the boss's own messages; clicking an entry jumps to it.
 *
 * Layout: the container spans the thread's width but is `pointer-events: none`,
 * so only the button and the (open) panel are hit-testable — the empty strip
 * never blocks the transcript. The panel is the first flow child and the button
 * the last, with the container pinned to the bottom corner, so the panel grows
 * upwards and the button never moves.
 *
 * Animation: `grid-template-rows: 0fr → 1fr` (+ opacity) gives a real height
 * expand without a `max-height` guess; the collapsed panel is `inert`, so it
 * can neither be clicked nor reached with Tab. Moving the pointer from the
 * button to the panel crosses the 8px gap, which briefly leaves the container —
 * the `CLOSE_DELAY` debounce absorbs that (and a re-entry cancels it), so the
 * list never flickers while the pointer travels.
 *
 * Order: the entries are in transcript order (oldest first), so opening the list
 * starts scrolled to the bottom — the most recent thing the boss said is what
 * she usually wants. Home/End therefore mean oldest/newest.
 */
export function MyMessageJump({
  threadRef,
  entries,
  onSelect,
}: MyMessageJumpProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  // The message nearest the top of the viewport; highlighted in the list.
  const [currentId, setCurrentId] = useState<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  // Timestamp until which a focus event is ignored: Escape moves the focus back
  // to the button and must not re-open the list it just closed. A short window
  // (not a one-shot flag) so that a focus event we never see cannot linger and
  // swallow the next pointer-enter.
  const suppressFocusUntilRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const cancelClose = useCallback((): void => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const scheduleClose = useCallback((): void => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, CLOSE_DELAY);
  }, [cancelClose]);

  // Drop a pending close timer when the control unmounts (module switch, chat
  // switch, or the list becoming empty).
  useEffect(() => cancelClose, [cancelClose]);

  /**
   * The entry the viewport is currently at — highlighted in the list. The first
   * boss message at or below the anchor line, falling back to the last one
   * above it when nothing is left (e.g. scrolled past all of them). One
   * `querySelectorAll` + one rect read per row, and only while the list is open,
   * so scrolling never costs a layout read.
   */
  const readCurrentId = useCallback((): number | null => {
    const thread = threadRef.current;
    if (!thread) return null;
    const ids = new Set(entries.map((entry) => entry.id));
    const anchor = thread.getBoundingClientRect().top + MY_JUMP_TOP_GAP;
    let above: number | null = null;
    for (const row of thread.querySelectorAll<HTMLElement>(
      "[data-message-id]",
    )) {
      const id = Number(row.dataset.messageId);
      if (!ids.has(id)) continue;
      if (row.getBoundingClientRect().top >= anchor - 1) return id;
      above = id;
    }
    return above;
  }, [entries, threadRef]);

  /**
   * The list body's `max-height` in px — i.e. how tall its scrollport will be
   * once the panel is expanded. Needed because `revealEntry` runs while the
   * panel is still collapsed (`0fr`) and the body therefore has no height yet.
   */
  const listViewport = useCallback((list: HTMLElement): number => {
    const parsed = Number.parseFloat(getComputedStyle(list).maxHeight);
    const cap = Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
    return Math.min(list.scrollHeight, cap);
  }, []);

  /**
   * Bring the highlighted entry into view inside the list body, `block: "nearest"`
   * style: leave the body alone when the row is already fully visible, otherwise
   * scroll the minimum needed. Done by assigning `scrollTop` (never
   * `scrollIntoView`, which would also scroll the thread — an ancestor — and
   * misbehaves while the body still has zero height), and computed against the
   * body's final viewport height so the growth of the panel can only clamp it
   * *downwards* to a still-correct position. No entry ⇒ fall back to the newest
   * (the bottom).
   */
  const revealEntry = useCallback(
    (messageId: number | null): void => {
      const list = listRef.current;
      if (!list) return;
      const row =
        messageId === null
          ? null
          : list.querySelector<HTMLElement>(
              `.imb-my-jump-item[data-entry-id="${messageId}"]`,
            );
      if (!row) {
        list.scrollTop = list.scrollHeight;
        return;
      }
      const viewport = listViewport(list);
      const listTop = list.getBoundingClientRect().top;
      const rowRect = row.getBoundingClientRect();
      const top = rowRect.top - listTop + list.scrollTop;
      const bottom = top + rowRect.height;
      if (top < list.scrollTop) {
        list.scrollTop = top;
      } else if (bottom > list.scrollTop + viewport) {
        list.scrollTop = bottom - viewport;
      }
      // Otherwise it is already fully visible: no scroll, no jump.
    },
    [listViewport],
  );

  // Stable handle so the open effect can read the position without re-running
  // whenever the entries change.
  const readCurrentIdRef = useRef(readCurrentId);
  readCurrentIdRef.current = readCurrentId;

  // On open: find the entry at the reading position, highlight it and put it in
  // view (so the list never opens showing a stretch of rows the highlight is
  // not in).
  useEffect(() => {
    if (!open) return;
    const id = readCurrentIdRef.current();
    setCurrentId(id);
    revealEntry(id);
  }, [open, revealEntry]);

  // Keep the highlight fresh while the list is open (a new message, or a fresh
  // load) without touching the body's scroll position.
  useEffect(() => {
    if (!open) return;
    setCurrentId(readCurrentIdRef.current());
  }, [open, readCurrentId]);

  /** Open the list, whatever the trigger (pointer, focus, click). */
  const showPanel = useCallback((): void => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  /**
   * Focus opens the list for keyboard users, except for the focus Escape itself
   * moves back to the button (see `suppressFocusUntilRef`). Pointer entry is
   * never suppressed — hovering is always an explicit request to see the list.
   */
  const handleFocus = useCallback((): void => {
    if (performance.now() < suppressFocusUntilRef.current) return;
    showPanel();
  }, [showPanel]);

  const closeAndRestoreFocus = useCallback((): void => {
    cancelClose();
    setOpen(false);
    const button = buttonRef.current;
    if (!button || document.activeElement === button) return;
    suppressFocusUntilRef.current = performance.now() + FOCUS_SUPPRESS_MS;
    button.focus();
  }, [cancelClose]);

  useEscapeKey(closeAndRestoreFocus, open);

  const handleBlur = (event: ReactFocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    scheduleClose();
  };

  // List rows are in transcript order, so Home lands on the oldest message and
  // End on the newest; ArrowDown walks towards newer messages, ArrowUp towards
  // older ones (the direction the transcript reads).
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const key = event.key;
    if (
      key !== "ArrowDown" &&
      key !== "ArrowUp" &&
      key !== "Home" &&
      key !== "End"
    ) {
      return;
    }
    const items = Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>(
        ".imb-my-jump-item",
      ) ?? [],
    );
    if (items.length === 0) return;
    const index = items.findIndex((item) => item === document.activeElement);
    let next: number;
    if (key === "Home") next = 0;
    else if (key === "End") next = items.length - 1;
    else if (key === "ArrowDown") {
      next = index < 0 ? 0 : Math.min(index + 1, items.length - 1);
    } else {
      next = index < 0 ? 0 : Math.max(index - 1, 0);
    }
    event.preventDefault();
    items[next]?.focus();
  };

  const handleSelect = (messageId: number): void => {
    // Keep the panel open: the pointer is still on it and another entry is one
    // click away.
    cancelClose();
    onSelect(messageId);
    setCurrentId(messageId);
  };

  // Defensive: the module hides the whole control when there is nothing to
  // list, so this only guards against a transient empty render.
  if (entries.length === 0) return null;

  const label = t("My messages");

  return (
    <div
      ref={containerRef}
      className={cls("imb-my-jump", open && "imb-my-jump-open")}
      onPointerEnter={showPanel}
      onPointerLeave={scheduleClose}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <div
        id={PANEL_ID}
        className="imb-my-jump-panel"
        role="group"
        aria-label={label}
        // `inert` keeps the collapsed panel out of the tab order and out of
        // hit-testing while it still occupies the DOM (needed for the
        // expand/collapse animation).
        inert={!open}
      >
        <div className="imb-my-jump-panel-inner">
          <div className="imb-my-jump-list" ref={listRef}>
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                data-entry-id={entry.id}
                className={cls(
                  "imb-my-jump-item",
                  entry.id === currentId && "imb-my-jump-item-current",
                )}
                aria-current={entry.id === currentId ? "true" : undefined}
                title={entry.text}
                onClick={() => handleSelect(entry.id)}
              >
                {entry.text}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button
        ref={buttonRef}
        type="button"
        className="imb-my-jump-fab"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={showPanel}
      >
        <IconList className="imb-my-jump-fab-icon" />
      </button>
    </div>
  );
}
