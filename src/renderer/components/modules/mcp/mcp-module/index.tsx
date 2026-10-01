import { t } from "@shared/l10n";
import type { McpServer, McpServerInput } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appStore, useApp } from "../../../../app-store";
import { useMultiSelect } from "../../../../hooks/use-multi-select";
import { ModuleView } from "../../../app-shell";
import { Avatar } from "../../../avatar";
import { Button } from "../../../button";
import { ContextMenu, type ContextMenuState } from "../../../context-menu";
import { ItemList } from "../../../item-list";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { Modal } from "../../../modal";
import { SearchInput } from "../../../search-input";
import "../../module-common.css";
import { McpAddModal } from "../mcp-add-modal";
import { McpDetail } from "../mcp-detail";

export function McpModule(): React.JSX.Element {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const { data } = useApp();
  const loading = data.mcp.loading;
  const listError = data.mcp.error;

  // Centralized in appStore (loaded once at startup); filter client-side.
  const servers = useMemo((): readonly McpServer[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.mcp.items;
    return data.mcp.items.filter(
      (server) =>
        server.name.toLowerCase().includes(needle) ||
        server.description.toLowerCase().includes(needle),
    );
  }, [data.mcp.items, query]);

  const multi = useMultiSelect<McpServer, string>({
    getKey: (server) => server.name,
    items: servers,
    onActivate: (server) => setSelectedName(server.name),
  });
  const clearSelection = multi.clear;

  // Query changes reset the selection (the old paginated resetVersion bump).
  useEffect(() => {
    clearSelection();
  }, [clearSelection, query]);

  // Re-fetch on every entry (MCP servers can change via the agent/external
  // edits); first load shows the loading state, revisits revalidate silently.
  useEffect(() => {
    void appStore.reloadMcp();
  }, []);

  // Auto-select the first server after page 1 loads (and recover when the
  // selected server disappears, e.g. bulk delete).
  useEffect(() => {
    if (loading) return;
    if (servers.length === 0) {
      setSelectedName(null);
      return;
    }
    setSelectedName((current) =>
      current !== null && servers.some((server) => server.name === current)
        ? current
        : servers[0].name,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, loading]);

  const selected =
    servers.find((server) => server.name === selectedName) ?? null;

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

  const remove = useCallback(async (name: string): Promise<void> => {
    try {
      const removed = await imb.mcp.remove(name);
      if (removed) appStore.removeMcp(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const deleteSelected = useCallback(async (): Promise<void> => {
    const names = [...multi.selectedKeys];
    if (names.length === 0) return;
    try {
      setDeleteOpen(false);
      for (const name of names) {
        await imb.mcp.remove(name);
        appStore.removeMcp(name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [multi.selectedKeys]);

  const toggleSelectAll = useCallback((): void => {
    if (multi.selectedKeys.size === servers.length && servers.length > 0) {
      multi.clear();
    } else {
      multi.selectAll();
    }
  }, [multi, servers.length]);

  const listPane = (
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
    <McpDetail
      key={selected.name}
      server={selected}
      onPatch={(input) => patch(selected.name, input)}
      onRemove={() => void remove(selected.name)}
    />
  ) : null;

  return (
    <>
      <ModuleView list={listPane} detail={detail} />
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
          {t("Linked employees must choose again after removing.")}
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
    </>
  );
}
