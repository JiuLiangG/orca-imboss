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
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return <div className="imb-detail-body">{children}</div>;
}
