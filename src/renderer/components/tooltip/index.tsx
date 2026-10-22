import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import {
  computeAnchoredPosition,
  DEFAULT_OFFSET,
  type AnchoredPosition,
  type Placement,
} from "./position";
import "./index.css";

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

/** Host props a tooltip must keep when it attaches to the trigger. */
interface TriggerProps {
  ref?: Ref<HTMLElement>;
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * Fixed, body-portalled tooltip that attaches itself to its child trigger via
 * `cloneElement` (preserving the host DOM structure). Hover-only: opens after a
 * short delay on `mouseenter`, closes immediately on `mouseleave`.
 *
 * The host's ref and mouse handlers are kept. A trigger that also anchors a
 * popover (the task-group halt button) still receives its own node.
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
  const [pos, setPos] = useState<AnchoredPosition | null>(null);

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
      computeAnchoredPosition(
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

  const childProps = children.props as TriggerProps;

  return (
    <>
      {cloneElement(children, {
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node;
          assignRef(childProps.ref, node);
        },
        onMouseEnter: (event: MouseEvent<HTMLElement>) => {
          childProps.onMouseEnter?.(event);
          show();
        },
        onMouseLeave: (event: MouseEvent<HTMLElement>) => {
          childProps.onMouseLeave?.(event);
          hide();
        },
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
