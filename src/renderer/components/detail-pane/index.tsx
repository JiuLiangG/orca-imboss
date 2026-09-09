import { cls } from "reactutils";
import "./index.css";

export interface DetailPaneProps {
  children: React.ReactNode;
  className?: string;
}

/** Col 3: scroll container for module detail content. */
export function DetailPane({
  children,
  className,
}: DetailPaneProps): React.JSX.Element {
  return <div className={cls("imb-detail-scroll", className)}>{children}</div>;
}
