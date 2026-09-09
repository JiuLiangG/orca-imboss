import { cls } from "reactutils";
import "./index.css";

export function DetailBody({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}): React.JSX.Element {
  return (
    <div className={cls("imb-detail-body", className)} style={style}>
      {children}
    </div>
  );
}
