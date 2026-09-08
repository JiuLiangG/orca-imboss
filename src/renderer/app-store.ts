import { SettingKeys } from "@shared/constants/settings";
import type {
  Employee,
  InstalledSkill,
  McpServer,
  ThemeState,
} from "@shared/types";
import { createRef } from "react";
import { proxy, useSnapshot } from "valtio";
import { updateLocale } from "./locale";
import { updateThemeState } from "./theme";

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
  locale: imb.initialLocale,
  theme: { mode: "system", color: "#07C160" } as ThemeState,
  navCollapsed: false,
  module: "chat" as AppModule,

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
    appStore.data.mcp.items.push(server);
  },
  replaceMcp(server: McpServer): void {
    const index = appStore.data.mcp.items.findIndex((s) => s.id === server.id);
    if (index >= 0) {
      appStore.data.mcp.items[index] = server;
    }
  },
  removeMcp(id: number): void {
    const index = appStore.data.mcp.items.findIndex((s) => s.id === id);
    if (index >= 0) {
      appStore.data.mcp.items.splice(index, 1);
    }
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
    appStore.data.employees.items.push(employee);
  },
  replaceEmployee(employee: Employee): void {
    const index = appStore.data.employees.items.findIndex(
      (e) => e.id === employee.id,
    );
    if (index >= 0) {
      appStore.data.employees.items[index] = employee;
    }
  },
  removeEmployee(id: number): void {
    if (id === 0) return; // built-in assistant is never removed.
    const index = appStore.data.employees.items.findIndex((e) => e.id === id);
    if (index >= 0) {
      appStore.data.employees.items.splice(index, 1);
    }
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
    appStore.data.chats.unread[chatId] = Math.max(0, unread);
  },
  async focusChat(chatId: number): Promise<void> {
    appStore.focusChatId = chatId;
    appStore.module = "chat";
    await imb.settings.set(SettingKeys.Module, "chat");
  },
});

/** One-time app-state bootstrap (theme/locale subscriptions + persisted prefs). */
let initialized = false;
export async function initApp(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await Promise.all([
    imb.theme.get(),
    imb.settings.get(SettingKeys.NavCollapse),
    imb.settings.get(SettingKeys.Module),
  ]).then(([theme, collapsed, storedModule]) => {
    updateThemeState(theme);
    if (collapsed === "1") {
      appStore.navCollapsed = true;
    }
    if (storedModule && (VALID_MODULES as string[]).includes(storedModule)) {
      appStore.module = storedModule as AppModule;
    }
  });
  imb.onLocaleChanged(updateLocale);
  imb.theme.onChanged(updateThemeState);

  // Centralized collections: load once, best-effort (non-blocking). A failed
  // load leaves the collection empty; the module's ensure*() retries on visit.
  await appStore.loadMcp();
  await appStore.loadSkills();
  await appStore.loadEmployees();

  // Chat unread mirror: load once, then keep in sync from the main process.
  await appStore.loadUnreads();
  imb.chats.onUnreadChanged(({ chatId, unread }) => {
    appStore.setChatUnread(chatId, unread);
  });

  // OS notification click → switch to the chat module and select the chat.
  imb.chats.onFocus((chatId) => {
    void appStore.focusChat(chatId);
  });
}

/** Reactive app-state hook (valtio snapshot). */
export function useApp() {
  return useSnapshot(appStore);
}
