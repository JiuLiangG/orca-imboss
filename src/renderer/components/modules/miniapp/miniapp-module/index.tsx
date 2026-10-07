import { t } from "@shared/l10n";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import { Button } from "../../../button";
import { EmptyState } from "../../../empty-state";
import "./index.css";

type Status = "loading" | "ready" | "error";

/**
 * Single-pane view for the active mini app. The main process starts the app's
 * supervised server (`imb.miniapps.open`) and resolves once the entry URL is
 * reachable, after which the app is embedded in a sandboxed iframe. The iframe
 * is deliberately cross-origin (loopback http(s)) so the mini app can never
 * reach this window's DOM or the `imb` preload bridge.
 */
export function MiniAppModule(): React.JSX.Element {
  const { activeMiniAppId, data } = useApp();
  const app =
    data.miniapps.items.find((item) => item.id === activeMiniAppId) ?? null;

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);

  const start = useCallback(async () => {
    if (activeMiniAppId === null) return;
    setStatus("loading");
    setError(null);
    try {
      await imb.miniapps.open(activeMiniAppId);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [activeMiniAppId]);

  useEffect(() => {
    setFrameKey(0);
    void start();
  }, [start]);

  const reload = useCallback(() => {
    setFrameKey((key) => key + 1);
    void start();
  }, [start]);

  if (!app) {
    return (
      <ModuleView
        content={
          <EmptyState>{t("Select a mini app from the sidebar")}</EmptyState>
        }
      />
    );
  }

  const content = (
    <div className="imb-miniapp">
      <div className="imb-miniapp-bar">
        <span className="imb-miniapp-title" title={app.name}>
          {app.name}
        </span>
        <Button size="sm" variant="secondary" onClick={reload}>
          {t("Reload")}
        </Button>
      </div>
      <div className="imb-miniapp-body">
        {status === "ready" ? (
          // Mounted only after the server is reachable: mounting earlier would
          // hit `connection refused` and leave the iframe on the error page,
          // since a ready server does not change `src`/`key` afterwards.
          <iframe
            key={frameKey}
            className="imb-miniapp-frame"
            src={app.entry}
            title={app.name}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
          />
        ) : status === "error" ? (
          <div className="imb-miniapp-status">
            <p className="imb-miniapp-status-title">
              {t("Failed to load mini app")}
            </p>
            <p className="imb-miniapp-error">{error}</p>
            <Button onClick={reload}>{t("Retry")}</Button>
          </div>
        ) : (
          <div className="imb-miniapp-status">
            <p className="imb-miniapp-status-title">{t("Loading…")}</p>
          </div>
        )}
      </div>
    </div>
  );

  return <ModuleView content={content} />;
}
