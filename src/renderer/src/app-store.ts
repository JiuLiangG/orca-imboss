import { createRef } from "react";
import { proxy, useSnapshot } from "valtio";
import type { ThemeState } from "../../shared/types";
import { setupL10N } from "../../shared/libs/l10n";
import zhCN from "../../shared/translations/zhCN.json";
import { applyThemeAccent, applyThemeModeAttr } from "./theme";

export type AppModule =
  | "chat"
  | "employees"
  | "models"
  | "mcp"
  | "skills"
  | "settings"
  | "miniapp-worldmap"
  | "chat-product";

const TRANSLATIONS = { "zh-CN": zhCN };

const NAV_COLLAPSE_KEY = "ui.navCollapsed";
const MODULE_KEY = "ui.module";

const VALID_MODULES: AppModule[] = [
  "chat",
  "employees",
  "models",
  "mcp",
  "skills",
  "settings",
  "miniapp-worldmap",
  "chat-product",
];

/** Pane mount points for modules (portal targets). These are mutable DOM refs,
 *  not reactive state, so they live outside the valtio proxy. */
export const listPaneRef = createRef<HTMLElement | null>();
export const detailPaneRef = createRef<HTMLElement | null>();

/** Global renderer app state (valtio proxy — replaces the former context). */
export const appStore = proxy({
  module: "chat" as AppModule,
  locale: window.imb.locale,
  theme: { mode: "system", color: "#07C160" } as ThemeState,
  navCollapsed: false,

  setModule(next: AppModule): void {
    appStore.module = next;
    void window.imb.settings.set(MODULE_KEY, next);
  },

  async setLocale(next: string): Promise<void> {
    setupL10N(next, TRANSLATIONS);
    appStore.locale = next;
    await window.imb.setLocale(next);
  },

  async setTheme(patch: Partial<ThemeState>): Promise<void> {
    const next = await window.imb.theme.set(patch);
    applyThemeAccent(next.color);
    applyThemeModeAttr(next.mode);
    appStore.theme = next;
  },

  setNavCollapsed(collapsed: boolean): void {
    appStore.navCollapsed = collapsed;
    void window.imb.settings.set(NAV_COLLAPSE_KEY, collapsed ? "1" : "0");
  },
});

/** One-time app-state bootstrap (theme/locale subscriptions + persisted prefs). */
let initialized = false;
export function initApp(): void {
  if (initialized) return;
  initialized = true;

  // theme: initial load + subscription
  void window.imb.theme.get().then((state) => {
    applyThemeAccent(state.color);
    applyThemeModeAttr(state.mode);
    appStore.theme = state;
  });
  window.imb.theme.onChanged((state) => {
    applyThemeAccent(state.color);
    applyThemeModeAttr(state.mode);
    appStore.theme = state;
  });

  // locale: subscription
  window.imb.onLocaleChanged((next) => {
    setupL10N(next, TRANSLATIONS);
    appStore.locale = next;
  });

  // nav collapse + module preference: persist in DB settings (KV)
  void Promise.all([
    window.imb.settings.get(NAV_COLLAPSE_KEY),
    window.imb.settings.get(MODULE_KEY),
  ]).then(([collapsed, storedModule]) => {
    if (collapsed === "1") appStore.navCollapsed = true;
    if (storedModule && (VALID_MODULES as string[]).includes(storedModule)) {
      appStore.module = storedModule as AppModule;
    }
  });
}

/** Reactive app-state hook (valtio snapshot). */
export function useApp() {
  return useSnapshot(appStore);
}
