import type { ReactNode } from "react";
import "./index.css";

export interface EmptyStateProps {
  children: ReactNode;
}

/** Centered muted empty block (`.list-empty` / detail empties). */
export function EmptyState({ children }: EmptyStateProps): React.JSX.Element {
  return <div className="imb-list-empty">{children}</div>;
}
