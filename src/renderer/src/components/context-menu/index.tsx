import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useClickOutside, useEscapeKey } from "../../hooks";
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

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/**
 * Fixed-position context menu with viewport edge clamping, click-outside and
 * Esc close. Rendered into `document.body` once (menu state lifted by caller).
 */
export function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState | null;
  onClose: () => void;
}): React.JSX.Element | null {
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
    let left = state.x;
    let top = state.y;
    if (rect.right > window.innerWidth) left = state.x - rect.width;
    if (rect.bottom > window.innerHeight) top = state.y - rect.height;
    setAdjusted({ left: Math.max(4, left), top: Math.max(4, top) });
  }, [state]);

  useClickOutside(ref, onClose, state !== null);
  useEscapeKey(onClose, state !== null);

  if (!state) return null;
  const { left, top } = adjusted ?? { left: state.x, top: state.y };

  return createPortal(
    <div
      ref={ref}
      className="imb-ctx-menu imb-open"
      role="menu"
      style={{ left, top }}
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
            className={`imb-ctx-menu-item${item.danger ? " imb-danger" : ""}`}
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
