import { useCallback, useEffect, useState } from "react";
import { t } from "../../../../../../shared/libs/l10n";
import type {
  Employee,
  EmployeeInput,
  InstalledSkill,
  McpServer,
  PageQuery,
  PageResult,
} from "../../../../../../shared/types";
import { ModuleView } from "../../../app-shell";
import { Avatar } from "../../../avatar";
import { Button } from "../../../button";
import { ContextMenu, type ContextMenuState } from "../../../context-menu";
import { ItemList } from "../../../item-list";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { Modal } from "../../../modal";
import "../../../modules/module-common.css";
import { SearchInput } from "../../../search-input";
import { useInfiniteList } from "../../../useInfiniteList";
import { useMultiSelect } from "../../../useMultiSelect";
import { EmployeeDetail } from "../employee-detail";
import { EmployeeRecruitModal } from "../employee-recruit-modal";

const PAGE_SIZE = 50;

/** Employees module: list (id 0 assistant hidden) + detail + recruit. */
export function EmployeesModule(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [recruitOpen, setRecruitOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  // Options for the multiselects / model select.
  const [mcpOptions, setMcpOptions] = useState<McpServer[]>([]);
  const [skillOptions, setSkillOptions] = useState<InstalledSkill[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);

  const refreshOptions = useCallback(async (): Promise<void> => {
    const [mcp, skills, models] = await Promise.all([
      window.imb.mcp.list(),
      window.imb.skills.list(),
      window.imb.models.list(),
    ]);
    setMcpOptions(mcp);
    setSkillOptions(skills);
    setModelOptions(models.map((m) => `${m.provider}/${m.id}`));
  }, []);

  const fetchPage = useCallback(
    (page: PageQuery): Promise<PageResult<Employee>> =>
      window.imb.employees.listPage(page),
    [],
  );
  const {
    items: employees,
    loading,
    loadingMore,
    hasMore,
    error: listError,
    loadMore,
    reset,
    mutate,
    resetVersion,
  } = useInfiniteList(fetchPage, { query, pageSize: PAGE_SIZE });

  useEffect(() => {
    void refreshOptions();
    const off = window.imb.skills.onChanged(() => void refreshOptions());
    return off;
  }, [refreshOptions]);

  const multi = useMultiSelect<Employee, number>({
    getKey: (employee) => employee.id,
    items: employees,
    onActivate: (employee) => setSelectedId(employee.id),
    resetVersion,
  });

  // Auto-select the first employee after page 1 loads (and recover when the
  // selected employee disappears, e.g. bulk delete).
  useEffect(() => {
    if (loading) return;
    if (employees.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) =>
      current !== null && employees.some((employee) => employee.id === current)
        ? current
        : employees[0].id,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, loading]);

  const selected =
    employees.find((employee) => employee.id === selectedId) ?? null;

  const patch = useCallback(
    async (id: number, input: EmployeeInput): Promise<boolean> => {
      try {
        const updated = await window.imb.employees.update(id, input);
        if (updated) {
          mutate((current) =>
            current.map((employee) =>
              employee.id === id ? updated : employee,
            ),
          );
        }
        setError(null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [mutate],
  );

  const matchesQuery = useCallback(
    (employee: Employee): boolean => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return (
        employee.name.toLowerCase().includes(needle) ||
        employee.role.toLowerCase().includes(needle)
      );
    },
    [query],
  );

  const create = useCallback(
    async (input: EmployeeInput): Promise<Employee | null> => {
      try {
        const created = await window.imb.employees.create(input);
        if (matchesQuery(created)) {
          // Newest id sorts last (id ASC) — append locally so the created
          // employee is immediately visible and selected.
          mutate((current) => [...current, created]);
          setSelectedId(created.id);
        } else {
          reset();
        }
        setError(null);
        return created;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [matchesQuery, mutate, reset],
  );

  const remove = useCallback(
    async (id: number): Promise<void> => {
      try {
        const removed = await window.imb.employees.remove(id);
        if (removed) {
          mutate((current) => current.filter((employee) => employee.id !== id));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [mutate],
  );

  const deleteSelected = useCallback(async (): Promise<void> => {
    const ids = [...multi.selectedKeys];
    if (ids.length === 0) return;
    try {
      setDeleteOpen(false);
      for (const id of ids) {
        await window.imb.employees.remove(id);
      }
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [multi.selectedKeys, reset]);

  const toggleSelectAll = useCallback((): void => {
    if (multi.selectedKeys.size === employees.length && employees.length > 0) {
      multi.clear();
    } else {
      multi.selectAll();
    }
  }, [multi, employees.length]);

  const listPane = (
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
      <ItemList
        items={employees}
        getItemKey={(employee) => employee.id}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        loadMore={() => void loadMore()}
        loadError={listError}
        selectable
        selectedKeys={multi.selectedKeys}
        onItemClick={(employee, index, mods) =>
          multi.onItemClick(employee, index, mods)
        }
        renderItem={(employee, { selected: isSelectedRow }) => (
          <ListRow
            active={employee.id === selectedId}
            selected={isSelectedRow}
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
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  {
                    key: "select-all",
                    label: t("Select all"),
                    onSelect: toggleSelectAll,
                  },
                  {
                    key: "delete",
                    label: t("Delete"),
                    danger: true,
                    onSelect: () => {
                      if (multi.selectedKeys.size === 0) multi.selectAll();
                      setDeleteOpen(true);
                    },
                  },
                ],
              });
            }}
          />
        )}
      />
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
  ) : null;

  return (
    <>
      <ModuleView list={listPane} detail={detail} />
      <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("Delete employees")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button variant="danger" onClick={() => void deleteSelected()}>
              {t("Delete")}
            </Button>
          </>
        }
      >
        <p className="imb-module-note">
          {t(
            "The employee's conversation records will also be cleared. This cannot be undone.",
          )}
        </p>
      </Modal>
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
