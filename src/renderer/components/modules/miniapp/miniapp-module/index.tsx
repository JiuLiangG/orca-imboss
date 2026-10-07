import { t } from "@shared/l10n";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import { contentPaneRef, useApp } from "../../../../app-store";
import { EmptyState } from "../../../empty-state";
import { MiniAppFrame } from "../miniapp-frame";
import "./index.css";

/**
 * Persistent host for every mini app visited this session. It is mounted for
 * the whole app lifetime (see `App.tsx`), so its `createPortal` into the
 * always-mounted shell content pane keeps the mini-app pages alive while other
 * sidebar modules are active. Only visibility changes on navigation — no
 * unmount, no reload.
 *
 * The host hides itself when the active module is not `miniapp`, and each
 * `MiniAppFrame` hides unless it is the active mini app.
 */
export function MiniAppModule(): React.JSX.Element | null {
  const { module, activeMiniAppId, visitedMiniAppIds } = useApp();
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setTarget(contentPaneRef.current);
  }, []);

  if (!target) return null;

  const visible = module === "miniapp";
  const content = (
    <div className={cls("imb-miniapp-host", !visible && "imb-is-hidden")}>
      {visitedMiniAppIds.length > 0 ? (
        visitedMiniAppIds.map((id) => (
          <MiniAppFrame
            key={id}
            id={id}
            active={visible && activeMiniAppId === id}
          />
        ))
      ) : (
        <EmptyState>{t("Select a mini app from the sidebar")}</EmptyState>
      )}
    </div>
  );

  return createPortal(content, target);
}
