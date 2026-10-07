import { SettingKeys } from "@shared/constants/settings";
import type {
  ChatSummary,
  Employee,
  InstalledSkill,
  McpServer,
  ProviderInfo,
  ThemeState,
  UpdaterState,
} from "@shared/types";
import { createRef } from "react";
import { proxy, useSnapshot } from "valtio";
import { updateLocale } from "./locale";
import { playNotificationSound } from "./sound";
import { updateThemeState } from "./theme";

export type AppModule =
  | "chat"
  | "employees"
  | "providers"
  | "mcp"
  | "skills"
  | "settings"
  | "miniapp-worldmap"
  | "group-chat";

/** A group chat opened from a `chat`-kind card and shown in the Nav. */
export interface OpenedChat {
  id: number;
  title: string;
  participants: number[];
}

/** Sections of the Settings module. Lifted here so main can deep-link to one. */
export type SettingsSection = "general" | "theme" | "about";

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
  "providers",
  "mcp",
  "skills",
  "settings",
  "miniapp-worldmap",
];

/** Global renderer app state (valtio proxy — replaces the former context). */
export const appStore = proxy({
  locale: imb.initialLocale,
  theme: { mode: "system", color: "#07C160" } as ThemeState,
  navCollapsed: false,
  module: "chat" as AppModule,

  // Group chats opened from `chat`-kind link cards, rendered in the Nav
  // "chats" section. Session-only: deliberately not persisted, so a restart
  // starts with none and the app falls back to the chat module.
  openedChats: [] as OpenedChat[],
  activeChatId: null as number | null,

  // Pending chat to select when the chat module is mounted (set by an OS
  // notification click). Cleared once consumed.
  focusChatId: null as number | null,

  // Active Settings section. Lifted out of `SettingsModule` so main can
  // deep-link to a section (the update notification opens "about").
  settingsSection: "general" as SettingsSection,

  // Auto-update state mirrored from main (see `initUpdater`).
  updater: {
    status: "idle",
    version: null,
    progress: null,
    error: null,
    checkedAt: null,
  } as UpdaterState,

  // Centralized collections loaded lazily on first visit and kept in sync by
  // the modules after each mutation (see ensureChats/ensureProviders).
  data: {
    chats: {
      items: [] as ChatSummary[],
      loading: false,
      loaded: false,
      error: null as string | null,
    },
    providers: {
      items: [] as ProviderInfo[],
      loading: false,
      loaded: false,
      error: null as string | null,
    },
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
  // MCP servers are DB-backed; a re-fetch is the most robust way to reflect an
  // add/update/delete (including agent/external changes) in the store.
  async reloadMcp(): Promise<void> {
    if (!appStore.data.mcp.loaded) appStore.data.mcp.loading = true;
    try {
      appStore.data.mcp.items = await imb.mcp.list();
      appStore.data.mcp.loaded = true;
      appStore.data.mcp.error = null;
    } catch (err) {
      console.error("[data:mcp]", err instanceof Error ? err.message : err);
      appStore.data.mcp.error =
        err instanceof Error ? err.message : String(err);
    } finally {
      appStore.data.mcp.loading = false;
    }
  },
  addMcp(server: McpServer): void {
    appStore.data.mcp.items.push(server);
  },
  replaceMcp(server: McpServer): void {
    const index = appStore.data.mcp.items.findIndex(
      (s) => s.name === server.name,
    );
    if (index >= 0) {
      appStore.data.mcp.items[index] = server;
    }
  },
  removeMcp(name: string): void {
    const index = appStore.data.mcp.items.findIndex((s) => s.name === name);
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
  // Employees can be created/updated by main (the agent's `imb_set_employees`
  // or IPC mutations), which pushes `employees:changed`; the subscription in
  // initAppStore re-fetches so chat avatars/names stay fresh between module
  // visits.
  async reloadEmployees(): Promise<void> {
    if (!appStore.data.employees.loaded) {
      appStore.data.employees.loading = true;
    }
    try {
      appStore.data.employees.items = await imb.employees.list();
      appStore.data.employees.loaded = true;
      appStore.data.employees.error = null;
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
  addEmployee(employee: Employee): void {
    // Idempotent: an `employees:changed` reload may race the optimistic add.
    const index = appStore.data.employees.items.findIndex(
      (e) => e.id === employee.id,
    );
    if (index >= 0) {
      appStore.data.employees.items[index] = employee;
    } else {
      appStore.data.employees.items.push(employee);
    }
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
  // most robust way to reflect an install/uninstall in the store. First load
  // shows the loading state; a revisit revalidates silently (stale data stays
  // visible until the response lands).
  async reloadSkills(): Promise<void> {
    if (!appStore.data.skills.loaded) appStore.data.skills.loading = true;
    try {
      appStore.data.skills.items = await imb.skills.list();
      appStore.data.skills.loaded = true;
      appStore.data.skills.error = null;
    } catch (err) {
      console.error("[data:skills]", err instanceof Error ? err.message : err);
      appStore.data.skills.error =
        err instanceof Error ? err.message : String(err);
    } finally {
      appStore.data.skills.loading = false;
    }
  },

  // --- Chats (full cache) --------------------------------------------------------
  async loadChats(): Promise<void> {
    if (appStore.data.chats.loading) return;
    appStore.data.chats.loading = true;
    appStore.data.chats.error = null;
    try {
      appStore.data.chats.items = await imb.chats.summaries();
      appStore.data.chats.loaded = true;
      sortChats();
    } catch (err) {
      console.error("[data:chats]", err instanceof Error ? err.message : err);
      appStore.data.chats.error =
        err instanceof Error ? err.message : String(err);
    } finally {
      appStore.data.chats.loading = false;
    }
  },
  ensureChats(): void {
    if (!appStore.data.chats.loaded && !appStore.data.chats.loading) {
      void appStore.loadChats();
    }
  },
  async reloadChats(): Promise<void> {
    try {
      appStore.data.chats.items = await imb.chats.summaries();
      appStore.data.chats.loaded = true;
      appStore.data.chats.error = null;
      sortChats();
    } catch (err) {
      console.error("[data:chats]", err instanceof Error ? err.message : err);
      appStore.data.chats.error =
        err instanceof Error ? err.message : String(err);
    }
  },
  async refreshChatSummary(id: number): Promise<void> {
    try {
      const summary = await imb.chats.summary(id);
      if (summary === null) {
        appStore.removeChat(id);
        return;
      }
      // Group chats (from_chat_id != null) are never cached as root chats.
      if (summary.fromChatId !== null) return;
      appStore.replaceChat(summary);
    } catch (err) {
      console.error(
        "[data:chats:refresh]",
        err instanceof Error ? err.message : err,
      );
    }
  },
  addChat(chat: ChatSummary): void {
    appStore.data.chats.items.push(chat);
    sortChats();
  },
  replaceChat(chat: ChatSummary): void {
    const index = appStore.data.chats.items.findIndex((c) => c.id === chat.id);
    if (index >= 0) {
      appStore.data.chats.items[index] = chat;
    } else {
      appStore.data.chats.items.push(chat);
    }
    sortChats();
  },
  removeChat(id: number): void {
    const index = appStore.data.chats.items.findIndex((c) => c.id === id);
    if (index >= 0) {
      appStore.data.chats.items.splice(index, 1);
    }
  },
  /**
   * Drop cascade-deleted chats (root + spawned descendants) from the cached
   * list and from the Nav opened-chat entries. The id set arrives over IPC, so
   * it is filtered defensively before use.
   */
  removeDeletedChats(ids: number[]): void {
    const deleted = new Set(
      ids.filter((id) => Number.isSafeInteger(id) && id > 0),
    );
    if (deleted.size === 0) return;
    for (const id of deleted) {
      appStore.removeChat(id);
    }
    if (appStore.focusChatId !== null && deleted.has(appStore.focusChatId)) {
      appStore.focusChatId = null;
    }
    // Close opened group chats (closeChat picks a neighbour / the chat module
    // fallback when the active one is removed).
    for (const chat of [...appStore.openedChats]) {
      if (deleted.has(chat.id)) appStore.closeChat(chat.id);
    }
  },
  setChatUnread(chatId: number, unread: number): void {
    const chat = appStore.data.chats.items.find((c) => c.id === chatId);
    if (chat) {
      chat.unread = Math.max(0, unread);
    }
  },

  // --- Providers (full cache) ----------------------------------------------------
  async loadProviders(): Promise<void> {
    if (appStore.data.providers.loading) return;
    appStore.data.providers.loading = true;
    appStore.data.providers.error = null;
    try {
      appStore.data.providers.items = await imb.providers.list();
      appStore.data.providers.loaded = true;
    } catch (err) {
      console.error(
        "[data:providers]",
        err instanceof Error ? err.message : err,
      );
      appStore.data.providers.error =
        err instanceof Error ? err.message : String(err);
    } finally {
      appStore.data.providers.loading = false;
    }
  },
  ensureProviders(): void {
    if (!appStore.data.providers.loaded && !appStore.data.providers.loading) {
      void appStore.loadProviders();
    }
  },
  // Providers are file-backed (auth/models), so a re-fetch is the most
  // robust way to reflect an upsert/remove in the store.
  async reloadProviders(): Promise<void> {
    try {
      appStore.data.providers.items = await imb.providers.list();
      appStore.data.providers.loaded = true;
      appStore.data.providers.error = null;
    } catch (err) {
      console.error(
        "[data:providers]",
        err instanceof Error ? err.message : err,
      );
      appStore.data.providers.error =
        err instanceof Error ? err.message : String(err);
    }
  },

  async focusChat(chatId: number): Promise<void> {
    appStore.focusChatId = chatId;
    appStore.module = "chat";
    await imb.settings.set(SettingKeys.Module, "chat");
  },

  /** Open the Settings module on a section (persists the active module). */
  async openSettings(section: SettingsSection): Promise<void> {
    appStore.settingsSection = section;
    appStore.module = "settings";
    await imb.settings.set(SettingKeys.Module, "settings");
  },

  // --- Auto-update ------------------------------------------------------------
  setUpdaterState(next: UpdaterState): void {
    appStore.updater = next;
  },
  async checkForUpdates(): Promise<UpdaterState> {
    const next = await imb.updater.check();
    appStore.setUpdaterState(next);
    return next;
  },
  async downloadUpdate(): Promise<void> {
    await imb.updater.download();
  },
  async cancelDownload(): Promise<void> {
    await imb.updater.cancel();
  },
  async installUpdate(): Promise<void> {
    await imb.updater.install();
  },

  // --- Opened group chats (Nav "chats" section) -------------------------------
  /** Open (or focus) a group chat linked by a `chat`-kind card. */
  openChat(chat: ChatSummary): void {
    const existing = appStore.openedChats.find((c) => c.id === chat.id);
    if (existing) {
      existing.title = chat.title;
      existing.participants = chat.participants;
    } else {
      appStore.openedChats.push({
        id: chat.id,
        title: chat.title,
        participants: chat.participants,
      });
    }
    appStore.activeChatId = chat.id;
    // Deliberately not persisted: opened chats are session-only.
    appStore.module = "group-chat";
  },

  /** Focus an already-opened group chat (Nav item click). */
  activateChat(id: number): void {
    if (!appStore.openedChats.some((c) => c.id === id)) return;
    appStore.activeChatId = id;
    appStore.module = "group-chat";
  },

  /** Close an opened group chat; fall back to a neighbour or the chat module. */
  closeChat(id: number): void {
    const index = appStore.openedChats.findIndex((c) => c.id === id);
    if (index < 0) return;
    appStore.openedChats.splice(index, 1);
    if (appStore.activeChatId !== id) return;
    const next =
      appStore.openedChats[index] ?? appStore.openedChats[index - 1] ?? null;
    if (next) {
      appStore.activeChatId = next.id;
    } else {
      appStore.activeChatId = null;
      appStore.module = "chat";
    }
  },
});

/** One-time app-state bootstrap (theme/locale subscriptions + persisted prefs). */
let initialized = false;
export async function initAppStore(): Promise<void> {
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

  // Chats / MCP / skills / employees / providers are NOT loaded here. They are
  // lazy-loaded by their module on first visit (see ensure*), and kept in sync
  // by the modules after each mutation.

  // Chats: every message append refreshes that chat's summary (preview,
  // lastAt, unread) and re-sorts the cached list. A lightweight unread-only
  // event (imb_notify / addUnread) updates items[].unread directly.
  imb.messages.onChanged(({ chatId, senderEmployeeId, silent, root }) => {
    void appStore.refreshChatSummary(chatId);
    // Beep for any non-silent employee/assistant message in a root chat,
    // regardless of the active module or the selected chat (group chats and
    // silent acks stay quiet). Throttled inside playNotificationSound().
    if (root && senderEmployeeId !== null && !silent) {
      playNotificationSound();
    }
  });
  // Title-only updates (auto title generation lands asynchronously, after the
  // messages:changed refresh) — same summary refresh keeps list + header in sync.
  imb.chats.onChanged(({ chatId }) => {
    void appStore.refreshChatSummary(chatId);
  });
  // Cascade deletes push the full deleted id set (root + spawned chats) so the
  // list cache, Nav opened chats and the focus target all stay consistent.
  imb.chats.onDeleted(({ chatIds }) => {
    if (Array.isArray(chatIds)) appStore.removeDeletedChats(chatIds);
  });
  imb.chats.onUnreadChanged(({ chatId, unread }) => {
    appStore.setChatUnread(chatId, unread);
  });

  // Employees can change from main with no renderer-side mutation (notably the
  // agent's `imb_set_employees` when it recruits staff mid-conversation).
  // Re-fetch the cache so chat avatars/names resolve immediately.
  imb.employees.onChanged(() => {
    void appStore.reloadEmployees();
  });

  // OS notification click → switch to the chat module and select the chat.
  imb.chats.onFocus((chatId) => {
    void appStore.focusChat(chatId);
  });

  // Updater state is pushed by main on every transition. Fetch once as well in
  // case the startup check completed before the renderer subscribed.
  imb.updater.onState((state) => {
    appStore.setUpdaterState(state);
  });
  void imb.updater
    .getState()
    .then((state) => appStore.setUpdaterState(state))
    .catch((err) => {
      console.error("[updater:getState]", err);
    });

  // Update notification click → Settings → About (validate the IPC string).
  imb.settings.onFocusSection((section) => {
    if (section === "general" || section === "theme" || section === "about") {
      void appStore.openSettings(section);
    }
  });
}

/** Reactive app-state hook (valtio snapshot). */
export function useApp() {
  return useSnapshot(appStore);
}

/** Keep the chat cache ordered newest-message-first (recency key, id breaks ties). */
function sortChats(): void {
  appStore.data.chats.items.sort(
    (a, b) => b.lastMessageAt - a.lastMessageAt || b.id - a.id,
  );
}
