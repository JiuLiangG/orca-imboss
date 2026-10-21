import { t } from "@shared/l10n";
import type { McpServer, McpServerInput } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appStore, useApp } from "../../../../app-store";
import { useDebouncedValue } from "../../../../hooks/use-debounced-value";
import { useModuleFilter } from "../../../../hooks/use-module-filter";
import { useMultiSelect } from "../../../../hooks/use-multi-select";
import { McpAddModal } from "../../mcp/mcp-add-modal";
import { McpDetail } from "../../mcp/mcp-detail";
import { Avatar } from "../../../avatar";
import { Button } from "../../../button";
import { ContextMenu, type ContextMenuState } from "../../../context-menu";
import { ItemList } from "../../../item-list";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { Modal } from "../../../modal";
import { ModuleNotice, useModuleNotice } from "../../../module-notice";
import { SearchInput } from "../../../search-input";
import "../../module-common.css";
import "../settings-split.css";

/**
 * Settings › MCP — the MCP server manager, embedded in the Settings detail
 * pane as a nested master/detail split (server list + selected server's
 * configuration). Moved out of the top-level nav so all configuration lives
 * under Settings.
 */
export function SettingsMcp(): React.JSX.Element {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  // Search text stored on the appStore so switching Settings sections / leaving
  // the Settings module does not lose it; session-only, cleared by a restart.
  // The input keeps the raw `query` (instant feedback); filtering uses the
  // debounced value so the list is not re-scanned on every keystroke.
  const { query, setQuery } = useModuleFilter("settings-mcp");
  const debouncedQuery = useDebouncedValue(query);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteNames, setDeleteNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const notice = useModuleNotice();

  const { data } = useApp();
  const loading = data.mcp.loading;
  const listError = data.mcp.error;

  // Centralized in appStore (loaded on first visit); filter client-side.
  const servers = useMemo((): readonly McpServer[] => {
    const needle = debouncedQuery.trim().toLowerCase();
    if (!needle) return data.mcp.items;
    return data.mcp.items.filter(
      (server) =>
        server.name.toLowerCase().includes(needle) ||
        server.description.toLowerCase().includes(needle),
    );
  }, [data.mcp.items, debouncedQuery]);

  const multi = useMultiSelect<McpServer, string>({
    getKey: (server) => server.name,
    items: servers,
    onActivate: (server) => setSelectedName(server.name),
  });
  const clearSelection = multi.clear;
  const selectSelection = multi.select;
  const selectedNameRef = useRef<string | null>(null);
  selectedNameRef.current = selectedName;

  // Query changes reset the selection (the old paginated resetVersion bump).
  useEffect(() => {
    clearSelection();
  }, [clearSelection, debouncedQuery]);

  // Re-fetch on every entry (MCP servers can change via the agent/external
  // edits); first load shows the loading state, revisits revalidate silently.
  // Employees are loaded too: the delete confirmation counts the employees that
  // link a server, and reading the collection is what triggers the
  // capability-reference self-heal in main.
  useEffect(() => {
    void appStore.reloadMcp();
    appStore.ensureEmployees();
  }, []);

  // Auto-select the first server after the list loads (and recover when the
  // selected server disappears, e.g. bulk delete). The resolved active item is
  // mirrored into `selectedKeys` so the active row is always selected.
  useEffect(() => {
    if (loading) return;
    if (servers.length === 0) {
      setSelectedName(null);
      clearSelection();
      return;
    }
    const current = selectedNameRef.current;
    const nextName =
      current !== null && servers.some((server) => server.name === current)
        ? current
        : servers[0].name;
    setSelectedName(nextName);
    selectSelection(nextName);
  }, [servers, loading, clearSelection, selectSelection]);

  const selected =
    servers.find((server) => server.name === selectedName) ?? null;

  /**
   * Employees currently linking any of `names`. MCP references are stored per
   * employee, and the renderer keeps the whole collection in memory, so the
   * count that drives the confirmation copy needs no extra IPC round trip.
   */
  const linkedEmployeeCount = useCallback(
    (names: readonly string[]): number => {
      if (names.length === 0) return 0;
      const set = new Set(names);
      let count = 0;
      for (const employee of data.employees.items) {
        if (employee.mcp.some((name) => set.has(name))) count += 1;
      }
      return count;
    },
    [data.employees.items],
  );

  /** Report a cascade result ("unlinked from N employees") as a transient note. */
  const reportUnlinked = useCallback(
    (employeeIds: readonly number[]): void => {
      if (employeeIds.length === 0) return;
      notice.show(
        t("Unlinked from ${count} employees.", {
          count: String(employeeIds.length),
        }),
      );
    },
    [notice],
  );

  const patch = useCallback(
    async (name: string, input: McpServerInput): Promise<void> => {
      const updated = await imb.mcp.update(name, input);
      if (updated) appStore.replaceMcp(updated);
    },
    [],
  );

  const create = useCallback(
    async (input: McpServerInput): Promise<boolean> => {
      try {
        const created = await imb.mcp.create(input);
        // Append so it is immediately visible and the auto-select effect picks
        // it up when it matches the filter.
        appStore.addMcp(created);
        setSelectedName(created.name);
        setError(null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [],
  );

  const remove = useCallback(
    async (name: string): Promise<void> => {
      try {
        const result = await imb.mcp.remove(name);
        if (result.removed) {
          appStore.removeMcp(name);
          reportUnlinked(result.unlinkedEmployeeIds);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [reportUnlinked],
  );

  const deleteSelected = useCallback(async (): Promise<void> => {
    if (deleteNames.length === 0) return;
    try {
      setDeleteOpen(false);
      const unlinked = new Set<number>();
      for (const name of deleteNames) {
        const result = await imb.mcp.remove(name);
        if (!result.removed) continue;
        appStore.removeMcp(name);
        for (const id of result.unlinkedEmployeeIds) unlinked.add(id);
      }
      reportUnlinked([...unlinked]);
      // Drop the just-deleted keys so a subsequent bulk action only acts on
      // the live list.
      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [deleteNames, clearSelection, reportUnlinked]);

  const toggleSelectAll = useCallback((): void => {
    if (multi.selectedKeys.size === servers.length && servers.length > 0) {
      multi.clear();
    } else {
      multi.selectAll();
    }
  }, [multi, servers.length]);

  const list = (
    <ListPane
      title={t("MCP")}
      search={
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("Search MCP name or description")}
        />
      }
      footer={
        <Button block onClick={() => setAddOpen(true)}>
          {t("Add MCP Server")}
        </Button>
      }
    >
      <ItemList
        items={servers}
        getItemKey={(server) => server.name}
        loading={loading}
        loadError={listError}
        emptyMessage={
          debouncedQuery.trim().length > 0
            ? t("No MCP servers match your search")
            : t("No MCP configured")
        }
        selectable
        selectedKeys={multi.selectedKeys}
        onItemClick={(server, index, mods) =>
          multi.onItemClick(server, index, mods)
        }
        renderItem={(server, { selected: isSelectedRow }) => (
          <ListRow
            active={server.name === selectedName}
            selected={isSelectedRow}
            avatar={
              <Avatar letter={server.name.slice(0, 2)} name={server.name} alt />
            }
            name={server.name}
            meta={server.config.transport}
            sub={server.description || "—"}
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
                      // Selection-aware: a right-click on an already-selected
                      // row deletes the whole selection; otherwise only the
                      // right-clicked server (never a hidden select-all).
                      setDeleteNames(
                        multi.selectedKeys.has(server.name)
                          ? [...multi.selectedKeys]
                          : [server.name],
                      );
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
    <McpDetail
      key={selected.name}
      server={selected}
      linkedEmployeeCount={linkedEmployeeCount([selected.name])}
      onPatch={(input) => patch(selected.name, input)}
      onRemove={() => void remove(selected.name)}
    />
  ) : null;

  // How many employees the pending deletion would unlink (drives the copy).
  const deleteAffected = linkedEmployeeCount(deleteNames);

  return (
    <div className="imb-settings-split">
      <div className="imb-settings-split-list">{list}</div>
      <div className="imb-settings-split-detail">{detail}</div>
      <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("Delete MCP servers")}
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
          {deleteAffected > 0
            ? t("Used by ${count} employees; they will be unlinked.", {
                count: String(deleteAffected),
              })
            : t("No employee uses it.")}
        </p>
      </Modal>
      <McpAddModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreate={create}
      />
      {error !== null && (
        <p className="imb-error-text imb-module-error">{error}</p>
      )}
      {notice.notice !== null && (
        <ModuleNotice message={notice.notice} onDismiss={notice.dismiss} />
      )}
    </div>
  );
}
