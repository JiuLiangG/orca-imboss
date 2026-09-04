import type { ReactNode } from "react";
import { cls } from "reactutils";
import "./index.css";

export interface ListRowProps {
  active?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  /** Left avatar slot. */
  avatar?: ReactNode;
  /** Row name (single line, ellipsis). */
  name: ReactNode;
  /** Right-side meta next to the name (time, transport tag…). */
  meta?: ReactNode;
  /** Sub line under the name (preview, role, description). */
  sub?: ReactNode;
  /** Badge on the right of the sub line (unread count…). */
  badge?: ReactNode;
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
}: ListRowProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cls(
        "imb-list-row",
        active && "imb-is-active",
        selected && "imb-is-selected",
      )}
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
  );
}
