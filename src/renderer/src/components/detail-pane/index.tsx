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
  return (
    <div className={`imb-detail-scroll${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

export function DetailHead({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="imb-detail-head">
      <div className="imb-detail-head-eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      {sub !== undefined && <div className="imb-sub">{sub}</div>}
      {actions !== undefined && (
        <div className="imb-detail-head-actions">{actions}</div>
      )}
    </div>
  );
}

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
