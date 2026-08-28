import { useApp, listPaneRef, detailPaneRef } from "../../app-store";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Nav } from "../nav";
import "./index.css";

/**
 * App shell — 3-column grid (208 | 300 | 1fr; collapsed 64px) with nav rail
 * plus two empty pane mount points. Active modules portal their list/detail
 * trees into those panes (see module-view).
 */
export function AppShell(): React.JSX.Element {
  const { navCollapsed, setNavCollapsed } = useApp();

  return (
    <div className={`imb-app${navCollapsed ? " imb-is-collapsed" : ""}`}>
      <Nav
        collapsed={navCollapsed}
        onToggle={() => setNavCollapsed(!navCollapsed)}
      />
      <section className="imb-pane imb-listpane" ref={listPaneRef} aria-label="List" />
      <section
        className="imb-pane imb-detailpane"
        ref={detailPaneRef}
        aria-label="Detail"
      />
    </div>
  );
}

export interface PaneContent {
  list: ReactNode;
  detail: ReactNode;
}

/** Renders module content into both panes (two portals, shared state). */
export function ModuleView({
  list,
  detail,
}: PaneContent): React.JSX.Element | null {
  const { module } = useApp();
  const [targets, setTargets] = useState<{
    list: HTMLElement | null;
    detail: HTMLElement | null;
  }>({ list: null, detail: null });

  useLayoutEffect(() => {
    setTargets({ list: listPaneRef.current, detail: detailPaneRef.current });
  }, [listPaneRef, detailPaneRef, module]);

  if (!targets.list || !targets.detail) return null;
  return (
    <>
      {createPortal(list, targets.list)}
      {createPortal(detail, targets.detail)}
    </>
  );
}
