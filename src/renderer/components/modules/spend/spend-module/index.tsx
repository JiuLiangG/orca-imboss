import { SPEND_RANGES, SPEND_RANGE_LABELS } from "@shared/constants/spend";
import { t } from "@shared/l10n";
import type { SpendReport } from "@shared/types";
import { useEffect, useState } from "react";
import { appStore, useApp } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import { EmployeeAvatar } from "../../../employee-avatar";
import { IconSpend } from "../../../icons";
import { ItemList } from "../../../item-list";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { SegmentedControl } from "../../../segmented-control";
import "../../module-common.css";
import { formatCost, formatTokensCompact } from "../format";
import { SpendDetail } from "../spend-detail";
import "./index.css";

/** One row of the list pane: the grand total, or one employee. */
interface SpendListEntry {
  key: string;
  /** `null` for the grand-total row. */
  employeeId: number | null;
  name: string;
  sub: string;
  tokens: number;
  cost: number;
}

export function SpendModule(): React.JSX.Element {
  const { spendRange, activeSpendEmployeeId } = useApp();
  const [report, setReport] = useState<SpendReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the `employees:changed` subscription to re-fetch the report.
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void imb.spend
      .report(spendRange)
      .then((next) => {
        if (alive) setReport(next);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [spendRange, refreshToken]);

  // Names/roles in the report come from the DB; a create/rename/delete pushed
  // by main (or the agent's `imb_set_employees`) invalidates them.
  useEffect(
    () => imb.employees.onChanged(() => setRefreshToken((token) => token + 1)),
    [],
  );

  // Drop a selection whose employee vanished from the report (hard delete).
  useEffect(() => {
    if (report === null || activeSpendEmployeeId === null) return;
    if (
      !report.employees.some((row) => row.employeeId === activeSpendEmployeeId)
    ) {
      appStore.activeSpendEmployeeId = null;
    }
  }, [report, activeSpendEmployeeId]);

  const entries: SpendListEntry[] = [];
  if (report !== null) {
    entries.push({
      key: "total",
      employeeId: null,
      name: t("Total"),
      sub: t("All employees"),
      tokens: report.totals.totalTokens,
      cost: report.totals.cost,
    });
    for (const employee of report.employees) {
      entries.push({
        key: `e${employee.employeeId}`,
        employeeId: employee.employeeId,
        name: employee.name,
        sub: employee.role || "—",
        tokens: employee.totals.totalTokens,
        cost: employee.totals.cost,
      });
    }
  }

  const list = (
    <ListPane
      title={t("Spend")}
      search={
        <SegmentedControl
          options={SPEND_RANGES.map((value) => ({
            value,
            label: t(SPEND_RANGE_LABELS[value]),
          }))}
          value={spendRange}
          onChange={(value) => {
            appStore.spendRange = value;
          }}
          label={t("Time range")}
        />
      }
    >
      <ItemList
        items={entries}
        getItemKey={(entry) => entry.key}
        loading={loading && report === null}
        loadError={error}
        emptyMessage={t("No spend recorded yet")}
        estimateSize={() => 56}
        renderItem={(entry) => (
          <ListRow
            active={entry.employeeId === activeSpendEmployeeId}
            avatar={
              entry.employeeId === null ? (
                <span className="imb-spend-total-avatar">
                  <IconSpend />
                </span>
              ) : (
                <EmployeeAvatar employeeId={entry.employeeId} size={30} />
              )
            }
            name={entry.name}
            meta={formatCost(entry.cost)}
            sub={`${formatTokensCompact(entry.tokens)} · ${entry.sub}`}
            onClick={() => {
              appStore.activeSpendEmployeeId = entry.employeeId;
            }}
          />
        )}
      />
    </ListPane>
  );

  const detail = (
    <SpendDetail
      report={report}
      employeeId={activeSpendEmployeeId}
      loading={loading}
      error={error}
    />
  );

  return <ModuleView list={list} detail={detail} />;
}
