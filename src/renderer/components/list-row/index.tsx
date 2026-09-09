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
