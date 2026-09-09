import type { ReactNode } from "react";
import "./index.css";

export interface ChipProps {
  children: ReactNode;
  onRemove?: () => void;
  removable?: boolean;
  title?: string;
}

export function Chip({
  children,
  onRemove,
  removable = false,
  title,
}: ChipProps): React.JSX.Element {
  return (
    <span className="imb-ms-chip" title={title}>
      {children}
      {removable && (
        <button
          type="button"
          className="imb-ms-chip-x"
          aria-label={title ?? "Remove"}
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
