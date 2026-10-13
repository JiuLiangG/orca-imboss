import { t } from "@shared/l10n";
import type {
  SpendDayBreakdown,
  SpendEmployeeReport,
  SpendModelBreakdown,
  SpendReport,
  SpendTotals,
} from "@shared/types";
import { DetailBody } from "../../../detail-pane/detail-body";
import { DetailHead } from "../../../detail-pane/detail-head";
import { formatCost, formatDayShort, formatTokens } from "../format";
import "./index.css";

export interface SpendDetailProps {
  report: SpendReport | null;
  /** `null` shows the grand total across every employee. */
  employeeId: number | null;
  loading: boolean;
  error: string | null;
}

/** One resolved detail view (an employee, or the grand total). */
interface SpendView {
  eyebrow: string;
  title: string;
  sub?: string;
  totals: SpendTotals;
  byModel: SpendModelBreakdown[];
  byDay: SpendDayBreakdown[];
  /** Distinct chats; `null` for the grand total (chats overlap by design). */
  chats: number | null;
}

export function SpendDetail({
  report,
  employeeId,
  loading,
  error,
}: SpendDetailProps): React.JSX.Element | null {
  if (error !== null) {
    return (
      <DetailBody>
        <p className="imb-module-note">
          {t("Failed to load spend statistics")}
        </p>
      </DetailBody>
    );
  }
  if (!report) {
    return loading ? (
      <DetailBody>
        <p className="imb-module-note">{t("Loading…")}</p>
      </DetailBody>
    ) : null;
  }

  const employee =
    employeeId === null
      ? null
      : (report.employees.find((row) => row.employeeId === employeeId) ?? null);
  const view: SpendView = employee ? employeeView(employee) : totalView(report);

  return (
    <>
      <DetailHead eyebrow={view.eyebrow} title={view.title} sub={view.sub} />
      <DetailBody>
        <StatsGrid view={view} />
        <section className="imb-spend-section">
          <h3>{t("Daily trend")}</h3>
          <UsageTrend days={view.byDay} />
        </section>
        <section className="imb-spend-section">
          <h3>{t("By model")}</h3>
          {view.byModel.length === 0 ? (
            <p className="imb-module-note">{t("No spend recorded yet")}</p>
          ) : (
            <div className="imb-spend-table">
              <div className="imb-spend-table-head">
                <span>{t("Provider")}</span>
                <span>{t("Model")}</span>
                <span className="imb-spend-num">{t("Tokens")}</span>
                <span className="imb-spend-num">{t("Calls")}</span>
                <span className="imb-spend-num">{t("Cost")}</span>
              </div>
              {view.byModel.map((model) => (
                <div
                  className="imb-spend-table-row"
                  key={`${model.provider}\u0000${model.model}`}
                >
                  <span className="imb-spend-ellipsis">
                    {model.provider || "—"}
                  </span>
                  <span className="imb-spend-ellipsis" title={model.model}>
                    {model.model || "—"}
                  </span>
                  <span className="imb-spend-num">
                    {formatTokens(model.totals.totalTokens)}
                  </span>
                  <span className="imb-spend-num">
                    {formatTokens(model.totals.calls)}
                  </span>
                  <span className="imb-spend-num">
                    {formatCost(model.totals.cost)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </DetailBody>
    </>
  );
}

function employeeView(employee: SpendEmployeeReport): SpendView {
  return {
    eyebrow: `Employee #${employee.employeeId}`,
    title: employee.name,
    sub: employee.role || "—",
    totals: employee.totals,
    byModel: employee.byModel,
    byDay: employee.byDay,
    chats: employee.chats,
  };
}

function totalView(report: SpendReport): SpendView {
  return {
    eyebrow: t("Total"),
    title: t("All employees"),
    totals: report.totals,
    byModel: report.byModel,
    byDay: report.byDay,
    chats: null,
  };
}

/** Token/cost tiles for one resolved view. */
function StatsGrid({ view }: { view: SpendView }): React.JSX.Element {
  const tiles: Array<{ label: string; value: string }> = [
    { label: t("Tokens"), value: formatTokens(view.totals.totalTokens) },
    { label: t("Input tokens"), value: formatTokens(view.totals.input) },
    { label: t("Output tokens"), value: formatTokens(view.totals.output) },
    { label: t("Cache read"), value: formatTokens(view.totals.cacheRead) },
    { label: t("Cache write"), value: formatTokens(view.totals.cacheWrite) },
    { label: t("Cost"), value: formatCost(view.totals.cost) },
    { label: t("Calls"), value: formatTokens(view.totals.calls) },
  ];
  if (view.chats !== null) {
    tiles.push({ label: t("Chats"), value: formatTokens(view.chats) });
  }
  return (
    <div className="imb-spend-stats">
      {tiles.map((tile) => (
        <div className="imb-spend-stat" key={tile.label}>
          <span className="imb-spend-stat-label">{tile.label}</span>
          <span className="imb-spend-stat-value">{tile.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Dense daily bar chart (pure CSS; no chart dependency). */
function UsageTrend({
  days,
}: {
  days: readonly SpendDayBreakdown[];
}): React.JSX.Element {
  const max = days.reduce(
    (highest, day) => Math.max(highest, day.totals.totalTokens),
    0,
  );
  const first = days[0];
  const last = days[days.length - 1];
  return (
    <div className="imb-spend-trend-block">
      <div className="imb-spend-trend" role="img" aria-label={t("Daily trend")}>
        {days.map((day) => {
          const tokens = day.totals.totalTokens;
          const height =
            max > 0 ? Math.max((tokens / max) * 100, tokens > 0 ? 2 : 0) : 0;
          return (
            <div
              className="imb-spend-trend-col"
              key={day.date}
              title={`${day.date} · ${formatTokens(tokens)} ${t("Tokens")} · ${formatCost(day.totals.cost)}`}
            >
              <div
                className="imb-spend-trend-bar"
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      {first !== undefined && last !== undefined && (
        <div className="imb-spend-trend-axis">
          <span>{formatDayShort(first.date)}</span>
          <span>{formatDayShort(last.date)}</span>
        </div>
      )}
    </div>
  );
}
