import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import "./index.css";

type Placement = "top" | "bottom" | "left" | "right";

const DEFAULT_OFFSET = 8;
const VIEWPORT_MARGIN = 4;

export interface TooltipProps {
  /** Bubble content (text). */
  content: ReactNode;
  /** Single trigger element to which the tooltip is attached. */
  children: ReactElement<Record<string, unknown>>;
  /** Side the bubble opens on (defaults to right, for the left nav rail). */
  placement?: Placement;
  /** When true the tooltip never shows. */
  disabled?: boolean;
  /** Hover show-delay in ms (default 300); hide is immediate. */
  delay?: number;
  /** Gap (px) between the trigger and the bubble. */
  offset?: number;
}

interface Pos {
  top: number;
  left: number;
  placement: Placement;
}

const OPPOSITE: Record<Placement, Placement> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/**
 * Fixed, body-portalled tooltip that attaches itself to its child trigger via
 * `cloneElement` (preserving the host DOM structure). Hover-only: opens after a
 * short delay on `mouseenter`, closes immediately on `mouseleave`.
 */
export function Tooltip({
  content,
  children,
  placement = "right",
  disabled = false,
  delay = 300,
  offset = DEFAULT_OFFSET,
}: TooltipProps): React.JSX.Element {
  const triggerRef = useRef<HTMLElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);

  // Clear any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  // When disabled flips on, drop any open tooltip / pending timer.
  useEffect(() => {
    if (disabled) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setOpen(false);
    }
  }, [disabled]);

  // Recompute the bubble position whenever it opens/repaints.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    setPos(
      computePos(
        placement,
        trigger.getBoundingClientRect(),
        bubble.getBoundingClientRect(),
        offset,
      ),
    );
  }, [open, placement, offset]);

  function show(): void {
    if (disabled) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), delay);
  }

  function hide(): void {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  }

  return (
    <>
      {cloneElement(children, {
        ref: triggerRef,
        onMouseEnter: show,
        onMouseLeave: hide,
      })}
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            className={cls("imb-tooltip", pos && "imb-tooltip-open")}
            data-placement={pos?.placement ?? placement}
            style={{ top: pos?.top, left: pos?.left }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Anchor the bubble for `side`, centered on the trigger's edge. Returns the
 * un-clamped top/left. Centering is absolute for the cross axis, so it may fall
 * off-screen on the cross axis; the caller clamps.
 */
function basePosition(
  side: Placement,
  trigger: DOMRect,
  bubble: DOMRect,
  offset: number,
): { top: number; left: number } {
  switch (side) {
    case "top":
      return {
        top: trigger.top - offset - bubble.height,
        left: trigger.left + trigger.width / 2 - bubble.width / 2,
      };
    case "bottom":
      return {
        top: trigger.bottom + offset,
        left: trigger.left + trigger.width / 2 - bubble.width / 2,
      };
    case "left":
      return {
        top: trigger.top + trigger.height / 2 - bubble.height / 2,
        left: trigger.left - offset - bubble.width,
      };
    case "right":
      return {
        top: trigger.top + trigger.height / 2 - bubble.height / 2,
        left: trigger.right + offset,
      };
  }
}

/** Resolve the final placement, flipping once if it overflows, then clamping. */
function computePos(
  placement: Placement,
  trigger: DOMRect,
  bubble: DOMRect,
  offset: number,
): Pos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const overflow = (pos: { top: number; left: number }): boolean => {
    const topPad = Math.max(
      VIEWPORT_MARGIN - pos.top,
      pos.top + bubble.height + VIEWPORT_MARGIN - vh,
      0,
    );
    const leftPad = Math.max(
      VIEWPORT_MARGIN - pos.left,
      pos.left + bubble.width + VIEWPORT_MARGIN - vw,
      0,
    );
    return topPad + leftPad > 0;
  };

  let side = placement;
  let pos = basePosition(side, trigger, bubble, offset);
  if (overflow(pos)) {
    side = OPPOSITE[side];
    pos = basePosition(side, trigger, bubble, offset);
  }

  return {
    top: Math.max(
      VIEWPORT_MARGIN,
      Math.min(pos.top, vh - bubble.height - VIEWPORT_MARGIN),
    ),
    left: Math.max(
      VIEWPORT_MARGIN,
      Math.min(pos.left, vw - bubble.width - VIEWPORT_MARGIN),
    ),
    placement: side,
  };
}
