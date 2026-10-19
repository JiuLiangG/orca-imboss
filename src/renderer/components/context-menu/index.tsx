import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import { useClickOutside } from "../../hooks/use-click-outside";
import { useEscapeKey } from "../../hooks/use-escape-key";
import { usePopupLayer } from "../../hooks/use-popup-layer";
import {
  computeAnchoredPosition,
  type Align,
  type Placement,
} from "../tooltip/position";
import "./index.css";

export interface ContextMenuDivider {
  divider: true;
  key: string;
}

export interface ContextMenuAction {
  key: string;
  label: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

export type ContextMenuItem = ContextMenuAction | ContextMenuDivider;

/** Attach the menu to a trigger instead of the pointer position. */
export interface ContextMenuAnchor {
  /** Trigger rect in viewport coordinates (`getBoundingClientRect()`). */
  rect: DOMRect;
  /**
   * Preferred side of the trigger the menu opens on (`"top"` opens above it,
   * `"bottom"` below). Flips once when it would overflow the viewport.
   * Defaults to `"bottom"`.
   */
  placement?: Placement;
  /**
   * Cross-axis alignment relative to the trigger. `"start"` (default) aligns
   * the menu's leading edge with the trigger's (dropdown convention);
   * `"center"` centres it on the trigger.
   */
  align?: Align;
}

export interface ContextMenuState {
  items: ContextMenuItem[];
  /** Pointer position (viewport coordinates) — a free-standing menu. */
  x?: number;
  y?: number;
  /**
   * Anchor to a trigger element; wins over `x`/`y`. The menu is edge-aligned
   * to the trigger and positioned with the shared anchored-position maths
   * (one flip + viewport clamp, same as `Tooltip`/`Popover`).
   */
  anchor?: ContextMenuAnchor;
}

export interface ContextMenuProps {
  state: ContextMenuState | null;
  onClose: () => void;
}

/** Gap between an anchored trigger and its menu. */
const MENU_OFFSET = 6;
/** Minimum distance kept from the viewport edges (matches the tooltip math). */
const VIEWPORT_MARGIN = 4;

/**
 * Fixed-position context menu with viewport edge clamping, click-outside and
 * Esc close. Rendered into `document.body` once (menu state lifted by caller).
 *
 * Two anchoring modes:
 * - pointer (`x`/`y`): opens at the cursor and is pulled back inside the
 *   viewport (right-click menus).
 * - trigger (`anchor`): edge-aligned to a button and flipped/clamped by
 *   `computeAnchoredPosition` (dropdown menus, e.g. Recruit).
 */
export function ContextMenu({
  state,
  onClose,
}: ContextMenuProps): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!state) {
      setAdjusted(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    // Dropdown mode: share the tooltip/popover flip + clamp maths, but align
    // the menu's leading edge with the trigger's instead of centring it.
    if (state.anchor !== undefined) {
      const pos = computeAnchoredPosition(
        state.anchor.placement ?? "bottom",
        state.anchor.rect,
        rect,
        MENU_OFFSET,
        state.anchor.align ?? "start",
      );
      setAdjusted({ left: pos.left, top: pos.top });
      return;
    }

    let left = state.x ?? 0;
    let top = state.y ?? 0;
    if (rect.right > window.innerWidth) left = (state.x ?? 0) - rect.width;
    if (rect.bottom > window.innerHeight) top = (state.y ?? 0) - rect.height;
    setAdjusted({
      left: Math.max(VIEWPORT_MARGIN, left),
      top: Math.max(VIEWPORT_MARGIN, top),
    });
  }, [state]);

  useClickOutside(ref, onClose, state !== null);
  useEscapeKey(onClose, state !== null);
  // The menu is portaled to `document.body`, so an enclosing `Modal` must not
  // close on the Escape that dismisses it (see `popup-layer.ts`).
  usePopupLayer(state !== null);

  if (!state) return null;
  const { left, top } = adjusted ?? { left: state.x ?? 0, top: state.y ?? 0 };
  // An anchored menu has no meaningful pre-measure position: keep it invisible
  // for the single frame before `useLayoutEffect` resolves it (a pointer menu
  // already sits at the cursor, so it stays visible).
  const pendingAnchor = state.anchor !== undefined && adjusted === null;

  return createPortal(
    <div
      ref={ref}
      className="imb-ctx-menu imb-open"
      role="menu"
      style={{
        left,
        top,
        ...(pendingAnchor ? { visibility: "hidden" as const } : null),
      }}
    >
      {state.items.map((item) => {
        if ("divider" in item) {
          return (
            <div
              key={item.key}
              className="imb-ctx-menu-divider"
              role="separator"
            />
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={cls("imb-ctx-menu-item", item.danger && "imb-danger")}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
