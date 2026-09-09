import "./index.css";

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
