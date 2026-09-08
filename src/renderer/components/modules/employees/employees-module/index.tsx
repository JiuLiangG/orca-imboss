import {
  BUILTIN_REMOVE_CRON_MARKER,
  BUILTIN_SET_CRON_MARKER,
} from "@shared/constants/agent_tools";
import { t } from "@shared/l10n";
import type { Employee, EmployeeInput } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appStore, useApp } from "../../../../app-store";
import { useMultiSelect } from "../../../../hooks/use-multi-select";
import { ModuleView } from "../../../app-shell";
import { Avatar } from "../../../avatar";
import { Button } from "../../../button";
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuState,
} from "../../../context-menu";
import { ItemList } from "../../../item-list";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { Modal } from "../../../modal";
import "../../../modules/module-common.css";
import type { MultiSelectOption } from "../../../multi-select";
import { SearchInput } from "../../../search-input";
import { employeeAvatarSrc } from "../employee-avatar";
import { EmployeeDetail } from "../employee-detail";
import { EmployeeRecruitModal } from "../employee-recruit-modal";

/** Employees module: list (assistant pinned atop, non-removable) + detail + recruit. */
export function EmployeesModule(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [recruitOpen, setRecruitOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const { data } = useApp();
  const loading = data.employees.loading;
  const listError = data.employees.error;

  // Centralized in appStore (loaded once at startup); filter client-side.
  const employees = useMemo((): Employee[] => {
    // Valtio snapshot elements are deeply readonly; clone the nested ref
    // arrays into mutable copies so they satisfy the Employee type.
    const source = data.employees.items.map((employee) => ({
      ...employee,
      mcp: [...employee.mcp],
      skills: [...employee.skills],
    }));
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter(
      (employee) =>
        employee.name.toLowerCase().includes(needle) ||
        employee.role.toLowerCase().includes(needle),
    );
  }, [data.employees.items, query]);

  // Model options still come via IPC (models out of scope); loaded once.
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  useEffect(() => {
    void imb.models
      .list()
      .then((models) =>
        setModelOptions(models.map((m) => `${m.provider}/${m.id}`)),
      )
      .catch(() => {
        // Best-effort: model selects stay empty on failure.
      });
  }, []);

  // Re-fetch on revisit when the startup load failed (best-effort).
  useEffect(() => {
    appStore.ensureEmployees();
  }, []);

  // Linked-MCP options = built-in opt-in cron tools + configured MCP servers.
  const mcpOptions = useMemo((): MultiSelectOption[] => {
    return [
      { value: BUILTIN_SET_CRON_MARKER, label: t("Set cron job") },
      { value: BUILTIN_REMOVE_CRON_MARKER, label: t("Remove cron job") },
      ...data.mcp.items.map((m) => ({ value: m.name, label: m.name })),
    ];
  }, [data.mcp.items]);

  const multi = useMultiSelect<Employee, number>({
    getKey: (employee) => employee.id,
    items: employees,
    onActivate: (employee) => setSelectedId(employee.id),
    // The built-in assistant is always pinned but never selectable; bulk
    // actions and "Select all" must not be able to reach it.
    isSelectable: (employee) => employee.id !== 0,
  });
  const clearSelection = multi.clear;

  // Query changes reset the selection.
  useEffect(() => {
    clearSelection();
  }, [clearSelection, query]);

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
        const updated = await imb.employees.update(id, input);
        if (updated) appStore.replaceEmployee(updated);
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
        const created = await imb.employees.create(input);
        // Newest id sorts last (id ASC) — append so it is immediately visible.
        appStore.addEmployee(created);
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

  const remove = useCallback(async (id: number): Promise<void> => {
    try {
      const removed = await imb.employees.remove(id);
      if (removed) appStore.removeEmployee(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const deleteSelected = useCallback(async (): Promise<void> => {
    const ids = [...multi.selectedKeys].filter((id) => id !== 0);
    if (ids.length === 0) return;
    try {
      setDeleteOpen(false);
      for (const id of ids) {
        await imb.employees.remove(id);
        appStore.removeEmployee(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [multi.selectedKeys]);

  const toggleSelectAll = useCallback((): void => {
    // Compare against selectable rows only (the assistant is never selectable,
    // so counting every loaded row would break the toggle-to-clear branch).
    const selectableCount = employees.filter(
      (employee) => employee.id !== 0,
    ).length;
    if (multi.selectedKeys.size === selectableCount && selectableCount > 0) {
      multi.clear();
    } else {
      multi.selectAll();
    }
  }, [multi, employees]);

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
                src={employeeAvatarSrc(employee)}
                letter={employee.name.slice(0, 1)}
                name={employee.name}
                alt
              />
            }
            name={employee.name || t("Unnamed")}
            sub={employee.role || "—"}
            badge={
              employee.id === 0 ? (
                <span className="imb-badge">{t("Built-in")}</span>
              ) : undefined
            }
            onContextMenu={(e) => {
              e.preventDefault();
              const items: ContextMenuItem[] = [
                {
                  key: "select-all",
                  label: t("Select all"),
                  onSelect: toggleSelectAll,
                },
              ];
              if (employee.id !== 0) {
                items.push({
                  key: "delete",
                  label: t("Delete"),
                  danger: true,
                  onSelect: () => {
                    if (multi.selectedKeys.size === 0) multi.selectAll();
                    setDeleteOpen(true);
                  },
                });
              }
              setCtxMenu({ x: e.clientX, y: e.clientY, items });
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
      mcpOptions={mcpOptions}
      skillOptions={data.skills.items.map((s) => ({
        value: s.name,
        label: s.name,
      }))}
      modelOptions={modelOptions.map((m) => ({ value: m, label: m }))}
      onPatch={(input) => patch(selected.id, input)}
      onRemove={() => void remove(selected.id)}
      onAvatarUpdated={(employee) => appStore.replaceEmployee(employee)}
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
        mcpOptions={mcpOptions}
        skillOptions={data.skills.items.map((s) => ({
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
