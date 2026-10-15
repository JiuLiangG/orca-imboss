import type { ReactNode } from "react";
import { cls } from "reactutils";
import "./index.css";

export interface ListRowProps {
  active?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  avatar?: ReactNode;
  name: ReactNode;
  meta?: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  /**
   * Optional content rendered on its own full-width line below the row button
   * (e.g. the tag editor). It sits outside the button, so it may itself be
   * interactive without nesting buttons.
   */
  footer?: ReactNode;
  className?: string;
}

/** Generic list row reused by every module's list pane. */
export function ListRow({
  active = false,
  selected = false,
  onClick,
  onContextMenu,
  avatar,
  name,
  meta,
  sub,
  badge,
  footer,
  className,
}: ListRowProps): React.JSX.Element {
  return (
    // The active/selected/hover surfaces live on the wrapper so a `footer`
    // line is highlighted together with the row.
    <div
      className={cls(
        "imb-list-row-wrap",
        active && "imb-is-active",
        selected && "imb-is-selected",
        className,
      )}
    >
      <button
        type="button"
        className="imb-list-row"
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        {avatar}
        <span className="imb-list-row-body">
          <span className="imb-list-row-top">
            <span className="imb-list-row-name">{name}</span>
            {meta !== undefined && (
              <span className="imb-list-row-time">{meta}</span>
            )}
          </span>
          {(sub !== undefined || badge !== undefined) && (
            <span className="imb-list-row-sub">
              {sub !== undefined && (
                <span className="imb-list-row-desc">{sub}</span>
              )}
              {badge !== undefined && badge}
            </span>
          )}
        </span>
      </button>
      {footer !== undefined && (
        <div
          className="imb-list-row-footer"
          // A click in the footer must not also trigger the row click (the
          // selectable-mode selection owned by `ItemList`).
          onClick={(event) => event.stopPropagation()}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
