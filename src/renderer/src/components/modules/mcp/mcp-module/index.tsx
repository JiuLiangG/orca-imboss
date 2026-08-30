import { useCallback, useEffect, useState } from "react";
import { t } from "../../../../../../shared/libs/l10n";
import type {
  McpServer,
  McpServerInput,
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
import { SearchInput } from "../../../search-input";
import { useInfiniteList } from "../../../useInfiniteList";
import { useMultiSelect } from "../../../useMultiSelect";
import "../../module-common.css";
import { McpAddModal } from "../mcp-add-modal";
import { McpDetail } from "../mcp-detail";

const PAGE_SIZE = 50;

/** MCP servers module: list + transport-aware config detail + add. */
export function McpModule(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const fetchPage = useCallback(
    (page: PageQuery): Promise<PageResult<McpServer>> =>
      window.imb.mcp.listPage(page),
    [],
  );
  const {
    items: servers,
    loading,
    loadingMore,
    hasMore,
    error: listError,
    loadMore,
    reset,
    mutate,
    resetVersion,
  } = useInfiniteList(fetchPage, { query, pageSize: PAGE_SIZE });

  const multi = useMultiSelect<McpServer, number>({
    getKey: (server) => server.id,
    items: servers,
    onActivate: (server) => setSelectedId(server.id),
    resetVersion,
  });

  // Auto-select the first server after page 1 loads (and recover when the
  // selected server disappears, e.g. bulk delete).
  useEffect(() => {
    if (loading) return;
    if (servers.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) =>
      current !== null && servers.some((server) => server.id === current)
        ? current
        : servers[0].id,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, loading]);

  const selected = servers.find((server) => server.id === selectedId) ?? null;

  const patch = useCallback(
    async (id: number, input: McpServerInput): Promise<void> => {
      const updated = await window.imb.mcp.update(id, input);
      if (updated) {
        mutate((current) =>
          current.map((server) => (server.id === id ? updated : server)),
        );
      }
    },
    [mutate],
  );

  const matchesQuery = useCallback(
    (server: McpServer): boolean => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return (
        server.name.toLowerCase().includes(needle) ||
        server.description.toLowerCase().includes(needle)
      );
    },
    [query],
  );

  const create = useCallback(
    async (input: McpServerInput): Promise<boolean> => {
      try {
        const created = await window.imb.mcp.create(input);
        if (matchesQuery(created)) {
          // Newest id sorts last (id ASC) — append locally so the created
          // server is immediately visible and selected.
          mutate((current) => [...current, created]);
          setSelectedId(created.id);
        } else {
          reset();
        }
        setError(null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [matchesQuery, mutate, reset],
  );

  const remove = useCallback(
    async (id: number): Promise<void> => {
      try {
        const removed = await window.imb.mcp.remove(id);
        if (removed) {
          mutate((current) => current.filter((server) => server.id !== id));
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
        await window.imb.mcp.remove(id);
      }
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [multi.selectedKeys, reset]);

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
        getItemKey={(server) => server.id}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        loadMore={() => void loadMore()}
        loadError={listError}
        selectable
        selectedKeys={multi.selectedKeys}
        onItemClick={(server, index, mods) =>
          multi.onItemClick(server, index, mods)
        }
        renderItem={(server, { selected: isSelectedRow }) => (
          <ListRow
            active={server.id === selectedId}
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
      key={selected.id}
      server={selected}
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
          {t(
            "The configuration will be permanently deleted. Linked employees must choose again.",
          )}
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
