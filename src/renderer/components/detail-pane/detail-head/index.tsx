import "./index.css";

export interface DetailHeadProps {
  /** Small mono label above the title (module kind), e.g. "Skill". */
  eyebrow?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** Row actions pinned to the right of the title row. */
  actions?: React.ReactNode;
}

/**
 * Detail pane header: eyebrow + title + sub on the left, optional actions on the
 * right of the same row. The title lives in its own flex item so a long title
 * wraps inside the leftover width instead of running underneath the actions; on
 * cramped panes it ellipsizes instead (the plain-string title/sub become native
 * hover tooltips so the full text stays reachable).
 *
 * The outer wrapper only exists to be the container-query context: the cramped
 * rules have to restyle `.imb-detail-head` itself (its wrapping mode), and an
 * element cannot query its own size.
 */
export function DetailHead({
  eyebrow,
  title,
  sub,
  actions,
}: DetailHeadProps): React.JSX.Element {
  // Only plain strings can back a native `title` tooltip; ReactNode titles (the
  // cron detail renders an avatar + name) are left alone.
  const titleTooltip = typeof title === "string" ? title : undefined;
  const subTooltip = typeof sub === "string" ? sub : undefined;
  return (
    <div className="imb-detail-head-wrap">
      <div className="imb-detail-head">
        <div className="imb-detail-head-main">
          {eyebrow !== undefined && (
            <div className="imb-detail-head-eyebrow">{eyebrow}</div>
          )}
          <h2 title={titleTooltip}>{title}</h2>
          {sub !== undefined && (
            <div className="imb-sub" title={subTooltip}>
              {sub}
            </div>
          )}
        </div>
        {actions !== undefined && (
          <div className="imb-detail-head-actions">{actions}</div>
        )}
      </div>
    </div>
  );
}
