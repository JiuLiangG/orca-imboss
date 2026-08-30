import { useCallback, useEffect, useState } from "react";
import { t } from "../../../../../../shared/libs/l10n";
import {
  CURATED_PROVIDERS_LABELS,
  type PageQuery,
  type PageResult,
  type ProviderInfo,
  type ProviderUpsert,
} from "../../../../../../shared/types";
import { ModuleView } from "../../../app-shell";
import { Avatar } from "../../../avatar";
import { Button } from "../../../button";
import { ContextMenu, type ContextMenuState } from "../../../context-menu";
import { ItemList } from "../../../item-list";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { Modal } from "../../../modal";
import { useInfiniteList } from "../../../useInfiniteList";
import { useMultiSelect } from "../../../useMultiSelect";
import "../../module-common.css";
import { ProviderAddModal } from "../provider-add-modal";
import { ProviderDetail } from "../provider-detail";

const PAGE_SIZE = 50;

/** Models module: provider list + detail (masked key reveal) + add. */
export function ModelsModule(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const fetchPage = useCallback(
    (page: PageQuery): Promise<PageResult<ProviderInfo>> =>
      window.imb.providers.listPage(page),
    [],
  );
  const {
    items: providers,
    loading,
    loadingMore,
    hasMore,
    error: listError,
    loadMore,
    reset,
    mutate,
    resetVersion,
  } = useInfiniteList(fetchPage, { pageSize: PAGE_SIZE });

  const multi = useMultiSelect<ProviderInfo, string>({
    getKey: (provider) => provider.id,
    items: providers,
    onActivate: (provider) => setSelectedId(provider.id),
    resetVersion,
  });

  // Auto-select the first provider after page 1 loads (and recover when the
  // selected provider disappears, e.g. bulk delete).
  useEffect(() => {
    if (loading) return;
    if (providers.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) =>
      current !== null && providers.some((provider) => provider.id === current)
        ? current
        : providers[0].id,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, loading]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      try {
        await window.imb.providers.remove(id);
        reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [reset],
  );

  const deleteSelected = useCallback(async (): Promise<void> => {
    const ids = [...multi.selectedKeys];
    if (ids.length === 0) return;
    try {
      setDeleteOpen(false);
      for (const id of ids) {
        await window.imb.providers.remove(id);
      }
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [multi.selectedKeys, reset]);

  const toggleSelectAll = useCallback((): void => {
    if (multi.selectedKeys.size === providers.length && providers.length > 0) {
      multi.clear();
    } else {
      multi.selectAll();
    }
  }, [multi, providers.length]);

  const handleSaved = useCallback(
    async (input: ProviderUpsert): Promise<void> => {
      // Persist the provider first, then re-read the full list to get the
      // authoritative record (masked key, generated models) and splice it into
      // the loaded pages in id order.
      await window.imb.providers.upsert(input);
      const all = await window.imb.providers.list();
      const saved = all.find((provider) => provider.id === input.id);
      if (saved) {
        mutate((current) => {
          const at = current.findIndex((provider) => provider.id === saved.id);
          if (at >= 0) {
            return current.map((provider) =>
              provider.id === saved.id ? saved : provider,
            );
          }
          const next = [...current];
          const insertAt = next.findIndex(
            (provider) => provider.id.localeCompare(saved.id) > 0,
          );
          next.splice(insertAt === -1 ? next.length : insertAt, 0, saved);
          return next;
        });
        setSelectedId(saved.id);
      } else {
        reset();
      }
    },
    [mutate, reset],
  );

  const selected =
    providers.find((provider) => provider.id === selectedId) ?? null;

  const listPane = (
    <ListPane
      title={t("Providers")}
      footer={
        <Button block onClick={() => setAddOpen(true)}>
          {t("Add Provider")}
        </Button>
      }
    >
      <ItemList
        items={providers}
        getItemKey={(provider) => provider.id}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        loadMore={() => void loadMore()}
        loadError={listError}
        selectable
        selectedKeys={multi.selectedKeys}
        onItemClick={(provider, index, mods) =>
          multi.onItemClick(provider, index, mods)
        }
        renderItem={(provider, { selected: isSelectedRow }) => (
          <ListRow
            active={provider.id === selectedId}
            selected={isSelectedRow}
            avatar={
              <Avatar letter={provider.id.slice(0, 1)} name={provider.id} alt />
            }
            name={CURATED_PROVIDERS_LABELS[provider.id] ?? provider.id}
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
    <ProviderDetail
      key={`${selected.kind}:${selected.id}`}
      provider={selected}
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
        title={t("Delete providers")}
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
          {t("The provider's API key and custom model config will be deleted.")}
        </p>
      </Modal>
      <ProviderAddModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={handleSaved}
      />
      {error !== null && (
        <p className="imb-error-text imb-module-error">{error}</p>
      )}
    </>
  );
}
