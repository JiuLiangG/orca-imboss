import { t } from "@shared/l10n";
import { useCallback, useEffect, useState } from "react";
import { cls } from "reactutils";
import { useApp } from "../../../../app-store";
import { Button } from "../../../button";
import "./index.css";

type Status = "loading" | "ready" | "error";

export interface MiniAppFrameProps {
  /** Folder id of the mini app this frame hosts. */
  id: string;
  /** Whether this frame is the active, visible mini app. */
  active: boolean;
}

/**
 * One mini-app web page, kept mounted for the whole session. The supervised
 * server is started once (`imb.miniapps.open`) on first mount; switching away
 * only hides the frame (`display:none`) so the embedded page is never reloaded.
 * Removing/reparenting the element — not hiding it — is what would reload it,
 * so this component must never be unmounted while the app is in use.
 */
export function MiniAppFrame({
  id,
  active,
}: MiniAppFrameProps): React.JSX.Element | null {
  const { data } = useApp();
  const app = data.miniapps.items.find((item) => item.id === id) ?? null;

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);

  const start = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      await imb.miniapps.open(id);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [id]);

  // Open exactly once, on first mount. Deliberately not keyed on visibility:
  // revisiting the app must not restart the server or reload the iframe.
  useEffect(() => {
    void start();
  }, [start]);

  const reload = useCallback(() => {
    setFrameKey((key) => key + 1);
    void start();
  }, [start]);

  if (!app) return null;

  return (
    <div className={cls("imb-miniapp", !active && "imb-is-hidden")}>
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
}
