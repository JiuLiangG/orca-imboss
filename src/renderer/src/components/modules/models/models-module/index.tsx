import { useCallback, useEffect, useState } from "react";
import type { ProviderInfo } from "../../../../../../shared/types";
import { t } from "../../../../../../shared/libs/l10n";
import { ModuleView } from "../../../app-shell";
import { Avatar } from "../../../avatar";
import { EmptyState } from "../../../empty-state";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { Button } from "../../../button";
import { ProviderDetail } from "../provider-detail";
import { ProviderAddModal } from "../provider-add-modal";
import "../../module-common.css";

/** Models module: provider list + detail (masked key reveal) + add. */
export function ModelsModule(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await window.imb.providers.list();
      setProviders(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await window.imb.providers.list();
        if (!alive) return;
        setProviders(data);
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

  const empty = providers.length === 0;

  const remove = useCallback(async (id: string): Promise<void> => {
    try {
      await window.imb.providers.remove(id);
      const data = await window.imb.providers.list();
      setProviders(data);
      if (data.length > 0) {
        setSelectedId((current) => (current === id ? data[0].id : current));
      } else {
        setSelectedId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const selected = providers.find((p) => p.id === selectedId) ?? null;

  const list = (
    <ListPane
      title={t("Providers")}
      footer={
        <Button block onClick={() => setAddOpen(true)}>
          {t("Add")}
        </Button>
      }
    >
      {loading ? (
        <EmptyState>{t("Loading…")}</EmptyState>
      ) : empty ? (
        <EmptyState>{t("No providers configured")}</EmptyState>
      ) : (
        providers.map((provider) => (
          <ListRow
            key={provider.id}
            active={provider.id === selectedId}
            avatar={
              <Avatar letter={provider.id.slice(0, 1)} name={provider.id} alt />
            }
            name={provider.id}
            sub={provider.hasKey ? t("Key set") : t("No key set")}
            onClick={() => setSelectedId(provider.id)}
          />
        ))
      )}
    </ListPane>
  );

  const detail = selected ? (
    <ProviderDetail
      key={`${selected.kind}:${selected.id}`}
      provider={selected}
      onRemove={() => void remove(selected.id)}
    />
  ) : (
    <div className="imb-detail-scroll">
      <div className="imb-chat-empty-detail">
        {t("No providers configured")}
      </div>
    </div>
  );

  return (
    <>
      <ModuleView list={list} detail={detail} />
      <ProviderAddModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={async (input) => {
          await refresh();
          setSelectedId(input.id);
        }}
      />
      {error !== null && (
        <p className="imb-error-text imb-module-error">{error}</p>
      )}
    </>
  );
}
