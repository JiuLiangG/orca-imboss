import { SettingKeys } from "@shared/constants";
import { setupL10N } from "@shared/l10n";
import zhCN from "@shared/translations/zhCN.json";
import type {
  Employee,
  InstalledSkill,
  McpServer,
  ThemeState,
} from "@shared/types";
import { createRef } from "react";
import { proxy, useSnapshot } from "valtio";
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

/** True when running on macOS (native traffic lights stay, no custom buttons). */
export const IS_MAC = imb.platform === "darwin";

/** Pane mount points for modules (portal targets). These are mutable DOM refs,
 *  not reactive state, so they live outside the valtio proxy. */
export const listPaneRef = createRef<HTMLElement | null>();
export const detailPaneRef = createRef<HTMLElement | null>();

/** Single content pane used by two-column (list-less) modules. */
export const contentPaneRef = createRef<HTMLElement | null>();

const TRANSLATIONS = { "zh-CN": zhCN };

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

/** Global renderer app state (valtio proxy — replaces the former context). */
export const appStore = proxy({
  module: "chat" as AppModule,
  locale: imb.initialLocale,
  theme: { mode: "system", color: "#07C160" } as ThemeState,
  navCollapsed: false,

  // Pending chat to select when the chat module is mounted (set by an OS
  // notification click). Cleared once consumed.
  focusChatId: null as number | null,

  // Centralized collections loaded once at startup and kept in sync by the
  // modules after each mutation. Chats is intentionally NOT here (it stays a
  // paged per-module list to keep large datasets lazy).
  data: {
    mcp: {
      items: [] as McpServer[],
      loading: false,
      loaded: false,
      error: null as string | null,
    },
    skills: {
      items: [] as InstalledSkill[],
      loading: false,
      loaded: false,
      error: null as string | null,
    },
    employees: {
      items: [] as Employee[],
      loading: false,
      loaded: false,
      error: null as string | null,
    },
    // Chats stays a paged per-module list (kept lazy); only the unread mirror
    // and the focus signal live here so notify/OS-notification jumps can reach
    // the chat module without loading the full list.
    chats: {
      unread: {} as Record<number, number>,
    },
  },

  // --- MCP -------------------------------------------------------------------
  async loadMcp(): Promise<void> {
    if (appStore.data.mcp.loading) return;
    appStore.data.mcp.loading = true;
    appStore.data.mcp.error = null;
    try {
      appStore.data.mcp.items = await imb.mcp.list();
      appStore.data.mcp.loaded = true;
    } catch (err) {
      console.error("[data:mcp]", err instanceof Error ? err.message : err);
      appStore.data.mcp.error =
        err instanceof Error ? err.message : String(err);
    } finally {
      appStore.data.mcp.loading = false;
    }
  },
  ensureMcp(): void {
    if (!appStore.data.mcp.loaded && !appStore.data.mcp.loading) {
      void appStore.loadMcp();
    }
  },
  addMcp(server: McpServer): void {
    appStore.data.mcp.items = [...appStore.data.mcp.items, server];
  },
  replaceMcp(server: McpServer): void {
    appStore.data.mcp.items = appStore.data.mcp.items.map((s) =>
      s.id === server.id ? server : s,
    );
  },
  removeMcp(id: number): void {
    appStore.data.mcp.items = appStore.data.mcp.items.filter(
      (s) => s.id !== id,
    );
  },

  // --- Employees --------------------------------------------------------------
  async loadEmployees(): Promise<void> {
    if (appStore.data.employees.loading) return;
    appStore.data.employees.loading = true;
    appStore.data.employees.error = null;
    try {
      appStore.data.employees.items = await imb.employees.list();
      appStore.data.employees.loaded = true;
    } catch (err) {
      console.error(
        "[data:employees]",
        err instanceof Error ? err.message : err,
      );
      appStore.data.employees.error =
        err instanceof Error ? err.message : String(err);
    } finally {
      appStore.data.employees.loading = false;
    }
  },
  ensureEmployees(): void {
    if (!appStore.data.employees.loaded && !appStore.data.employees.loading) {
      void appStore.loadEmployees();
    }
  },
  addEmployee(employee: Employee): void {
    appStore.data.employees.items = [
      ...appStore.data.employees.items,
      employee,
    ];
  },
  replaceEmployee(employee: Employee): void {
    appStore.data.employees.items = appStore.data.employees.items.map((e) =>
      e.id === employee.id ? employee : e,
    );
  },
  removeEmployee(id: number): void {
    if (id === 0) return; // built-in assistant is never removed.
    appStore.data.employees.items = appStore.data.employees.items.filter(
      (e) => e.id !== id,
    );
  },

  // --- Skills -----------------------------------------------------------------
  async loadSkills(): Promise<void> {
    if (appStore.data.skills.loading) return;
    appStore.data.skills.loading = true;
    appStore.data.skills.error = null;
    try {
      appStore.data.skills.items = await imb.skills.list();
      appStore.data.skills.loaded = true;
    } catch (err) {
      console.error("[data:skills]", err instanceof Error ? err.message : err);
      appStore.data.skills.error =
        err instanceof Error ? err.message : String(err);
    } finally {
      appStore.data.skills.loading = false;
    }
  },
  ensureSkills(): void {
    if (!appStore.data.skills.loaded && !appStore.data.skills.loading) {
      void appStore.loadSkills();
    }
  },
  // Skills come from the filesystem (name-ASC sorted), so a re-fetch is the
  // most robust way to reflect an install/uninstall in the store.
  async reloadSkills(): Promise<void> {
    try {
      appStore.data.skills.items = await imb.skills.list();
      appStore.data.skills.loaded = true;
      appStore.data.skills.error = null;
    } catch (err) {
      console.error("[data:skills]", err instanceof Error ? err.message : err);
      appStore.data.skills.error =
        err instanceof Error ? err.message : String(err);
    }
  },

  // --- Chats (unread mirror) ----------------------------------------------------
  async loadUnreads(): Promise<void> {
    try {
      appStore.data.chats.unread = await imb.chats.unreads();
    } catch (err) {
      console.error(
        "[data:chats:unread]",
        err instanceof Error ? err.message : err,
      );
    }
  },
  setChatUnread(chatId: number, unread: number): void {
    appStore.data.chats.unread = {
      ...appStore.data.chats.unread,
      [chatId]: Math.max(0, unread),
    };
  },
  focusChat(chatId: number): void {
    appStore.focusChatId = chatId;
  },

  setModule(next: AppModule): void {
    appStore.module = next;
    void imb.settings.set(SettingKeys.Module, next);
  },

  async setLocale(next: string): Promise<void> {
    setupL10N(next, TRANSLATIONS);
    appStore.locale = next;
    await imb.setLocale(next);
  },

  async setTheme(patch: Partial<ThemeState>): Promise<void> {
    const next = await imb.theme.set(patch);
    applyThemeAccent(next.color);
    applyThemeModeAttr(next.mode);
    appStore.theme = next;
  },

  setNavCollapsed(collapsed: boolean): void {
    appStore.navCollapsed = collapsed;
    void imb.settings.set(SettingKeys.NavCollapse, collapsed ? "1" : "0");
  },
});

/** One-time app-state bootstrap (theme/locale subscriptions + persisted prefs). */
let initialized = false;
export function initApp(): void {
  if (initialized) return;
  initialized = true;

  // theme: initial load + subscription
  void imb.theme.get().then((state) => {
    applyThemeAccent(state.color);
    applyThemeModeAttr(state.mode);
    appStore.theme = state;
  });
  imb.theme.onChanged((state) => {
    applyThemeAccent(state.color);
    applyThemeModeAttr(state.mode);
    appStore.theme = state;
  });

  // locale: subscription
  imb.onLocaleChanged((next) => {
    setupL10N(next, TRANSLATIONS);
    appStore.locale = next;
  });

  // nav collapse + module preference: persist in DB settings (KV)
  void Promise.all([
    imb.settings.get(SettingKeys.NavCollapse),
    imb.settings.get(SettingKeys.Module),
  ]).then(([collapsed, storedModule]) => {
    if (collapsed === "1") appStore.navCollapsed = true;
    if (storedModule && (VALID_MODULES as string[]).includes(storedModule)) {
      appStore.module = storedModule as AppModule;
    }
  });

  // Centralized collections: load once, best-effort (non-blocking). A failed
  // load leaves the collection empty; the module's ensure*() retries on visit.
  void appStore.loadMcp();
  void appStore.loadSkills();
  void appStore.loadEmployees();

  // Chat unread mirror: load once, then keep in sync from the main process.
  void appStore.loadUnreads();
  imb.chats.onUnreadChanged(({ chatId, unread }) => {
    appStore.setChatUnread(chatId, unread);
  });
  // OS notification click → switch to the chat module and select the chat.
  imb.chats.onFocus((chatId) => {
    appStore.setModule("chat");
    appStore.focusChat(chatId);
  });
}

/** Reactive app-state hook (valtio snapshot). */
export function useApp() {
  return useSnapshot(appStore);
}
