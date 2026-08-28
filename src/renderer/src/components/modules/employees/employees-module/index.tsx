import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Employee,
  EmployeeInput,
  InstalledSkill,
  McpServer,
  ProviderInfo,
} from "../../../../../../shared/types";
import { t } from "../../../../../../shared/libs/l10n";
import { ModuleView } from "../../../app-shell";
import "../../../modules/module-common.css";
import { Avatar } from "../../../avatar";
import { EmptyState } from "../../../empty-state";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { SearchInput } from "../../../search-input";
import { Button } from "../../../button";
import { EmployeeDetail } from "../employee-detail";
import { EmployeeRecruitModal } from "../employee-recruit-modal";

/** Employees module: list (id 0 assistant hidden) + detail + recruit. */
export function EmployeesModule(): React.JSX.Element {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [recruitOpen, setRecruitOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Options for the multiselects / model select.
  const [mcpOptions, setMcpOptions] = useState<McpServer[]>([]);
  const [skillOptions, setSkillOptions] = useState<InstalledSkill[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  const refreshOptions = useCallback(async (): Promise<void> => {
    const results = await Promise.all([
      window.imb.mcp.list(),
      window.imb.skills.list(),
      window.imb.providers.list(),
    ]);
    setMcpOptions(results[0]);
    setSkillOptions(results[1]);
    setProviders(results[2]);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await window.imb.employees.list();
        if (!alive) return;
        setEmployees(data.filter((e) => e.id !== 0));
        setMcpOptions(await window.imb.mcp.list());
        setSkillOptions(await window.imb.skills.list());
        setProviders(await window.imb.providers.list());
        if (data.length > 1)
          setSelectedId(data.filter((e) => e.id !== 0)[0]?.id ?? null);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    const off = window.imb.skills.onChanged(() => void refreshOptions());
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelOptions = useMemo(() => {
    return providers
      .filter((p) => p.modelIds.length > 0)
      .flatMap((p) => p.modelIds.map((m) => `${p.id}/${m}`));
  }, [providers]);

  const selected = employees.find((e) => e.id === selectedId) ?? null;

  const patch = useCallback(
    async (id: number, input: EmployeeInput): Promise<boolean> => {
      try {
        const updated = await window.imb.employees.update(id, input);
        if (updated) {
          setEmployees((current) =>
            current.map((e) => (e.id === id ? updated : e)),
          );
        }
        setError(null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [],
  );

  const create = useCallback(
    async (input: EmployeeInput): Promise<Employee | null> => {
      try {
        const created = await window.imb.employees.create(input);
        setEmployees((current) => [...current, created]);
        setSelectedId(created.id);
        setError(null);
        return created;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [],
  );

  const remove = useCallback(
    async (id: number): Promise<void> => {
      try {
        const removed = await window.imb.employees.remove(id);
        if (removed) {
          setEmployees((current) => {
            const next = current.filter((e) => e.id !== id);
            if (selectedId === id) {
              setSelectedId(next[0]?.id ?? null);
            }
            return next;
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [selectedId],
  );

  const filtered = employees.filter((e) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return e.name.toLowerCase().includes(q) || e.role.toLowerCase().includes(q);
  });

  const list = (
    <ListPane
      title={t("Employees")}
      search={
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("Filter by name or role")}
        />
      }
      footer={
        <Button block onClick={() => setRecruitOpen(true)}>
          {t("Recruit")}
        </Button>
      }
    >
      {loading ? (
        <EmptyState>{t("Loading…")}</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>{t("No matching employees")}</EmptyState>
      ) : (
        filtered.map((employee) => (
          <ListRow
            key={employee.id}
            active={employee.id === selectedId}
            avatar={
              <Avatar
                src={employee.avatarUrl}
                letter={employee.name.slice(0, 1)}
                name={employee.name}
                alt
              />
            }
            name={employee.name || t("Unnamed")}
            sub={employee.role || "—"}
            onClick={() => setSelectedId(employee.id)}
          />
        ))
      )}
    </ListPane>
  );

  const detail = selected ? (
    <EmployeeDetail
      key={selected.id}
      employee={selected}
      mcpOptions={mcpOptions.map((m) => ({ value: m.name, label: m.name }))}
      skillOptions={skillOptions.map((s) => ({
        value: s.name,
        label: s.name,
      }))}
      modelOptions={modelOptions.map((m) => ({ value: m, label: m }))}
      onPatch={(input) => patch(selected.id, input)}
      onRemove={() => void remove(selected.id)}
    />
  ) : (
    <div className="imb-detail-scroll">
      <div className="imb-chat-empty-detail">{t("No matching employees")}</div>
    </div>
  );

  return (
    <>
      <ModuleView list={list} detail={detail} />
      <EmployeeRecruitModal
        open={recruitOpen}
        onClose={() => setRecruitOpen(false)}
        mcpOptions={mcpOptions.map((m) => ({ value: m.name, label: m.name }))}
        skillOptions={skillOptions.map((s) => ({
          value: s.name,
          label: s.name,
        }))}
        modelOptions={modelOptions.map((m) => ({ value: m, label: m }))}
        onCreate={create}
      />
      {error !== null && (
        <p className="imb-error-text imb-module-error">{error}</p>
      )}
    </>
  );
}
