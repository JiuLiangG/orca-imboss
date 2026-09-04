import type { ReactNode } from "react";
import "./index.css";

export interface ChipProps {
  children: ReactNode;
  /** Remove button icon shown on the right (attachment chips). */
  onRemove?: () => void;
  removable?: boolean;
  title?: string;
}

/** Small pill tag (`ms-chip`, attachment chips inside bubbles). */
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
