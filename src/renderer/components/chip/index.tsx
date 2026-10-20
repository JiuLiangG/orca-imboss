import type { ReactNode } from "react";
import "./index.css";

export interface ChipProps {
  children: ReactNode;
  onRemove?: () => void;
  removable?: boolean;
  title?: string;
  /** Accessible name of the remove button (defaults to `title`, then "Remove"). */
  removeLabel?: string;
}

export function Chip({
  children,
  onRemove,
  removable = false,
  title,
  removeLabel,
}: ChipProps): React.JSX.Element {
  return (
    <span className="imb-ms-chip" title={title}>
      {children}
      {removable && (
        <button
          type="button"
          className="imb-ms-chip-x"
          aria-label={removeLabel ?? title ?? "Remove"}
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}
