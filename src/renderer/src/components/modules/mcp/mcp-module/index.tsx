import { useCallback, useEffect, useMemo, useState } from "react";
import type { McpServer, McpServerInput } from "../../../../../../shared/types";
import { t } from "../../../../../../shared/libs/l10n";
import { ModuleView } from "../../../app-shell";
import { Avatar } from "../../../avatar";
import { EmptyState } from "../../../empty-state";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { SearchInput } from "../../../search-input";
import { Button } from "../../../button";
import { McpDetail } from "../mcp-detail";
import { McpAddModal } from "../mcp-add-modal";
import "../../module-common.css";

/** MCP servers module: list + transport-aware config detail + add. */
export function McpModule(): React.JSX.Element {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await window.imb.mcp.list();
        if (!alive) return;
        setServers(data);
        if (data.length > 0) setSelectedId(data[0].id);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [servers, query]);

  const selected = servers.find((s) => s.id === selectedId) ?? null;

  const patch = useCallback(
    async (id: number, input: McpServerInput): Promise<void> => {
      const updated = await window.imb.mcp.update(id, input);
      if (updated) {
        setServers((current) =>
          current.map((s) => (s.id === id ? updated : s)),
        );
      }
    },
    [],
  );

  const create = useCallback(
    async (input: McpServerInput): Promise<boolean> => {
      try {
        const created = await window.imb.mcp.create(input);
        setServers((current) => [...current, created]);
        setSelectedId(created.id);
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
    async (id: number): Promise<void> => {
      try {
        const removed = await window.imb.mcp.remove(id);
        if (removed) {
          setServers((current) => {
            const next = current.filter((s) => s.id !== id);
            if (selectedId === id) setSelectedId(next[0]?.id ?? null);
            return next;
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [selectedId],
  );

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
          {t("Add")}
        </Button>
      }
    >
      {loading ? (
        <EmptyState>{t("Loading…")}</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>
          {servers.length === 0
            ? t("No matching MCP servers")
            : t("No matching MCP servers")}
        </EmptyState>
      ) : (
        filtered.map((server) => (
          <ListRow
            key={server.id}
            active={server.id === selectedId}
            avatar={
              <Avatar letter={server.name.slice(0, 2)} name={server.name} alt />
            }
            name={server.name}
            meta={server.config.transport}
            sub={server.description || "—"}
            onClick={() => setSelectedId(server.id)}
          />
        ))
      )}
    </ListPane>
  );

  const detail = selected ? (
    <McpDetail
      key={selected.id}
      server={selected}
      onPatch={(input) => patch(selected.id, input)}
      onRemove={() => void remove(selected.id)}
    />
  ) : (
    <div className="imb-detail-scroll">
      <div className="imb-chat-empty-detail">
        {t("No matching MCP servers")}
      </div>
    </div>
  );

  return (
    <>
      <ModuleView list={list} detail={detail} />
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
