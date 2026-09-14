import { CURATED_PROVIDERS_LABELS } from "@shared/constants/providers";
import { t } from "@shared/l10n";
import { type ProviderInfo, type ProviderUpsert } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
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
import "../../module-common.css";
import { ProviderAddModal } from "../provider-add-modal";
import { ProviderDetail } from "../provider-detail";

export function ProvidersModule(): React.JSX.Element {
  const { data } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  // Centralized in appStore (lazy-loaded on first visit); re-fetched after
  // every mutation for authoritative state (file-backed providers).
  const providers = data.providers.items as ProviderInfo[];
  const loading = data.providers.loading;
  const listError = data.providers.error;

  useEffect(() => {
    appStore.ensureProviders();
  }, []);

  const multi = useMultiSelect<ProviderInfo, string>({
    getKey: (provider) => provider.id,
    items: providers,
    onActivate: (provider) => setSelectedId(provider.id),
  });

  // Auto-select the first provider after load (and recover when the selected
  // provider disappears, e.g. bulk delete).
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

  const remove = useCallback(async (id: string): Promise<void> => {
    try {
      await imb.providers.remove(id);
      await appStore.reloadProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const deleteSelected = useCallback(async (): Promise<void> => {
    const ids = [...multi.selectedKeys];
    if (ids.length === 0) return;
    try {
      setDeleteOpen(false);
      for (const id of ids) {
        await imb.providers.remove(id);
      }
      await appStore.reloadProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [multi.selectedKeys]);

  const toggleSelectAll = useCallback((): void => {
    if (multi.selectedKeys.size === providers.length && providers.length > 0) {
      multi.clear();
    } else {
      multi.selectAll();
    }
  }, [multi, providers.length]);

  const save = useCallback(async (input: ProviderUpsert): Promise<void> => {
    // Persist first, then re-read the full list for the authoritative record
    // (masked key, generated models). Throws so the caller can surface errors.
    await imb.providers.upsert(input);
    await appStore.reloadProviders();
  }, []);

  const handleSaved = useCallback(
    async (input: ProviderUpsert): Promise<void> => {
      try {
        await save(input);
        setSelectedId(input.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [save],
  );

  const selected =
    providers.find((provider) => provider.id === selectedId) ?? null;

  const listPane = (
    <ListPane
      title={t("Model Providers")}
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
      onSave={save}
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
