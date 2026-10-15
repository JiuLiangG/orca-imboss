import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import { useClickOutside } from "../../hooks/use-click-outside";
import { useEscapeKey } from "../../hooks/use-escape-key";
import {
  computeAnchoredPosition,
  DEFAULT_OFFSET,
  type AnchoredPosition,
  type Placement,
} from "../tooltip/position";
import "./index.css";

export interface PopoverProps {
  open: boolean;
  /** Element the panel is anchored to; clicks inside it never close the panel. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Side the panel opens on (flips once when it would overflow). */
  placement?: Placement;
  /** Gap (px) between the anchor and the panel. */
  offset?: number;
  /** Interactive content (buttons, text, …). */
  children: ReactNode;
}

/**
 * Interactive, body-portalled floating panel anchored to a trigger element —
 * the confirmation surface for the Halt button.
 *
 * Reuses the `Tooltip` positioning math (same flip + viewport clamp via
 * `computeAnchoredPosition`) and the app's standard popup close behaviour
 * (`useClickOutside` + `useEscapeKey`). Unlike `Tooltip` it accepts focusable
 * content (`pointer-events: auto`), stays open on pointer-leave, and re-anchors
 * on scroll / resize so it never detaches from its button inside a scrolling
 * thread.
 */
export function Popover({
  open,
  anchorRef,
  onClose,
  placement = "right",
  offset = DEFAULT_OFFSET,
  children,
}: PopoverProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<AnchoredPosition | null>(null);

  useClickOutside([anchorRef, panelRef], onClose, open);
  useEscapeKey(onClose, open);

  const reposition = useCallback((): void => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    setPos(
      computeAnchoredPosition(
        placement,
        anchor.getBoundingClientRect(),
        panel.getBoundingClientRect(),
        offset,
      ),
    );
  }, [anchorRef, placement, offset]);

  // Position before paint so the panel never flashes at the origin.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    reposition();
  }, [open, reposition]);

  // Keep the panel glued to its anchor while the thread scrolls / the window
  // resizes.
  useEffect(() => {
    if (!open) return;
    const onViewportChange = (): void => reposition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, reposition]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={cls("imb-popover", pos && "imb-popover-open")}
      data-placement={pos?.placement ?? placement}
      style={{ top: pos?.top, left: pos?.left }}
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  );
}
