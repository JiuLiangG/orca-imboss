import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
} from "electron";
import type {
  ChatParticipantUpdate,
  Employee,
  EmployeeInput,
  McpServerInput,
  MessageAttachment,
  PageQuery,
  ProviderModelsQuery,
  ProviderUpsert,
} from "../../shared/types";
import { getAgentEnvironment } from "../agent/environment";
import {
  listModels,
  listProviders,
  listProvidersPage,
  removeProvider,
  revealProviderKey,
  upsertProvider,
} from "../agent/providers";
import {
  listAvailableModels,
  refreshModelStore,
} from "../agent/model-runtime";
import { AgentSession } from "../agent/session";
import {
  installSkillsFromFolders,
  listSkills,
  listSkillsPage,
  uninstallSkill,
} from "../agent/skills";
import { deleteAvatarFiles, saveAvatar } from "../avatars";
import * as chatsService from "../db/services/chats";
import * as employeesService from "../db/services/employees";
import * as mcpService from "../db/services/mcp";
import * as messagesService from "../db/services/messages";
import {
  deleteSession,
  getSession,
  listByChat,
  listByEmployee,
  setSession,
  unlinkSessionFile,
} from "../db/services/sessions";
import { getSetting, setSetting } from "../db/services/settings";
import { getResolvedLocale } from "../locale";
import {
  getThemeState,
  initTheme,
  sanitizeMode,
  setThemeColor,
  setThemeMode,
} from "../theme";

/** Register all renderer ↔ main IPC channels. */
export function registerIpcHandlers(): void {
  registerSettingsHandlers();
  registerEmployeeHandlers();
  registerChatHandlers();
  registerMessageHandlers();
  registerSessionHandlers();
  registerAgentEnvHandlers();
  registerMcpHandlers();
  registerThemeHandlers();
  registerWindowHandlers();
}

// --- window controls -----------------------------------------------------------

function registerWindowHandlers(): void {
  const winOf = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender);

  ipcMain.handle("window:minimize", (event) => {
    winOf(event)?.minimize();
  });
  ipcMain.handle("window:toggleMaximize", (event) => {
    const win = winOf(event);
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.handle("window:close", (event) => {
    winOf(event)?.close();
  });
  ipcMain.handle("window:isMaximized", (event) => {
    return winOf(event)?.isMaximized() ?? false;
  });
}

// --- settings / locale ------------------------------------------------------

function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", (_event, key: unknown) =>
    getSetting(assertString(key, "key")),
  );
  ipcMain.handle("settings:set", (_event, key: unknown, value: unknown) => {
    setSetting(assertString(key, "key"), assertString(value, "value"));
  });

  ipcMain.handle("locale:get", () => getResolvedLocale());
  ipcMain.handle("locale:set", (_event, locale: unknown) => {
    const newLocale = assertString(locale, "locale");
    setSetting("locale", newLocale);
    broadcast("locale:changed", newLocale);
    return newLocale;
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());
}

// --- employees ----------------------------------------------------------------

/** Enrich an employee with its avatar data URL (already done by the service). */
function registerEmployeeHandlers(): void {
  ipcMain.handle("employees:list", () => employeesService.listEmployees());

  ipcMain.handle("employees:listPage", (_event, page: unknown) =>
    employeesService.listEmployeesPage(parsePageQuery(page)),
  );

  ipcMain.handle("employees:create", (_event, input: EmployeeInput): Employee =>
    employeesService.createEmployee(input),
  );

  ipcMain.handle(
    "employees:update",
    (_event, id: unknown, input: EmployeeInput) => {
      const safeId = assertInteger(id, "employee id");
      return employeesService.updateEmployee(safeId, input);
    },
  );

  ipcMain.handle("employees:delete", async (_event, id: unknown) => {
    const safeId = assertInteger(id, "employee id");
    // Capture disk session file paths BEFORE the FK cascade wipes the rows.
    const records = listByEmployee(safeId);
    const removed = employeesService.deleteEmployee(safeId);
    if (removed) {
      await Promise.all(records.map((r) => unlinkSessionFile(r.session)));
      deleteAvatarFiles(safeId);
    }
    return removed;
  });

  ipcMain.handle(
    "employees:updateAvatar",
    (_event, id: unknown, ext: unknown, data: unknown) => {
      const safeId = assertInteger(id, "employee id");
      const safeExt = assertString(ext, "ext");
      if (!(data instanceof Uint8Array)) {
        throw new Error("Avatar data must be bytes.");
      }
      const path = saveAvatar(safeId, safeExt, Buffer.from(data));
      return employeesService.updateEmployeeAvatar(safeId, path);
    },
  );
}

// --- chats ----------------------------------------------------------------------

function registerChatHandlers(): void {
  ipcMain.handle("chats:list", () => chatsService.listChats());
  ipcMain.handle("chats:summaries", () => chatsService.listChatSummaries());

  ipcMain.handle("chats:summariesPage", (_event, page: unknown) =>
    chatsService.listChatSummariesPage(parsePageQuery(page)),
  );

  ipcMain.handle("chats:markRead", (_event, id: unknown) => {
    const safeId = assertInteger(id, "chat id");
    chatsService.markRead(safeId);
  });

  ipcMain.handle(
    "chats:create",
    (_event, title: unknown, participants: unknown[]) => {
      if (!Array.isArray(participants)) {
        throw new Error("participants must be an array.");
      }
      return chatsService.createChat(
        assertString(title, "title"),
        participants.map((p) => assertInteger(p, "participant id")),
      );
    },
  );

  ipcMain.handle("chats:update", (_event, id: unknown, title: unknown) => {
    const safeId = assertInteger(id, "chat id");
    return chatsService.updateChatTitle(safeId, assertString(title, "title"));
  });

  ipcMain.handle(
    "chats:updateParticipants",
    (_event, id: unknown, changes: ChatParticipantUpdate) => {
      const safeId = assertInteger(id, "chat id");
      return chatsService.updateChatParticipants(safeId, changes);
    },
  );

  ipcMain.handle("chats:delete", async (_event, id: unknown) => {
    const safeId = assertInteger(id, "chat id");
    const records = listByChat(safeId);
    const removed = chatsService.deleteChat(safeId);
    if (removed) {
      await Promise.all(records.map((r) => unlinkSessionFile(r.session)));
    }
    return removed;
  });

  /**
   * Chat pipeline: append the user message → run the Pi-backed
   * `AgentSession.prompt` (env-aware shell tools + the employee's MCP
   * servers) → persist the final assistant reply text. When no model is
   * configured yet, the canned placeholder reply is used instead.
   */
  ipcMain.handle(
    "chat:send",
    async (_event, chatId: unknown, content: unknown, attachments: unknown) => {
      const safeChatId = assertInteger(chatId, "chat id");
      const safeContent = assertString(content, "content");
      const safeAttachments = validateAttachmentsPayload(attachments);

      const userMessage = messagesService.appendMessage(
        safeChatId,
        null,
        safeContent.length > 0 ? safeContent : "[附件]",
        safeAttachments ? { attachments: safeAttachments } : {},
      );
      broadcast("messages:changed", safeChatId);
      broadcast("chats:summaries");

      void (async () => {
        const agentSession = new AgentSession(getAgentEnvironment(), {
          employeeId: employeesService.ASSISTANT_ID,
          chatId: safeChatId,
        });
        try {
          const result = await agentSession.prompt(safeContent);
          if (
            result.replied &&
            result.replyText &&
            result.replyText.length > 0
          ) {
            messagesService.appendMessage(
              safeChatId,
              employeesService.ASSISTANT_ID,
              result.replyText,
            );
          } else {
            appendCannedReply(safeChatId);
          }
        } catch {
          // A failing agent run must never lose the user's message; fall back.
          appendCannedReply(safeChatId);
        } finally {
          await agentSession.dispose();
        }
      })();

      return userMessage;
    },
  );
}

/** Canned placeholder reply (no model configured / agent run failed). */
function appendCannedReply(chatId: number): void {
  try {
    messagesService.appendMessage(
      chatId,
      employeesService.ASSISTANT_ID,
      "收到，已把任务拆解并派发给相关员工，完成后我会第一时间汇总给你。",
    );
    broadcast("messages:changed", chatId);
    broadcast("chats:summaries");
  } catch {
    // Chat may have been deleted before the reply lands; ignore.
  }
}

/** Validate the optional attachments payload before touching the DB. */
function validateAttachmentsPayload(
  value: unknown,
): MessageAttachment[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error("attachments must be an array.");
  // Field-level validation happens in the messages service; pass through and
  // let it throw on malformed entries.
  return value as MessageAttachment[];
}

// --- messages -------------------------------------------------------------------

function registerMessageHandlers(): void {
  ipcMain.handle("messages:list", (_event, chatId: unknown) =>
    messagesService.listMessages(assertInteger(chatId, "chat id")),
  );

  ipcMain.handle("messages:search", (_event, query: unknown) =>
    messagesService.searchMessages(assertString(query, "query")),
  );

  ipcMain.handle(
    "messages:append",
    (_event, chatId: unknown, senderEmployeeId: unknown, content: unknown) => {
      const safeChatId = assertInteger(chatId, "chat id");
      const safeSender =
        senderEmployeeId === null
          ? null
          : assertInteger(senderEmployeeId, "sender id");
      return messagesService.appendMessage(
        safeChatId,
        safeSender,
        assertString(content, "content"),
      );
    },
  );
}

// --- agent sessions -------------------------------------------------------------

function registerSessionHandlers(): void {
  ipcMain.handle(
    "sessions:get",
    (_event, employeeId: unknown, chatId: unknown) => {
      const safeEmployee = assertInteger(employeeId, "employee id");
      const safeChat = assertInteger(chatId, "chat id");
      return getSession(safeEmployee, safeChat);
    },
  );

  ipcMain.handle(
    "sessions:set",
    (_event, employeeId: unknown, chatId: unknown, sessionPath: unknown) => {
      const safeEmployee = assertInteger(employeeId, "employee id");
      const safeChat = assertInteger(chatId, "chat id");
      setSession(
        safeEmployee,
        safeChat,
        assertString(sessionPath, "session path"),
      );
    },
  );

  ipcMain.handle(
    "sessions:delete",
    (_event, employeeId: unknown, chatId: unknown) => {
      const safeEmployee = assertInteger(employeeId, "employee id");
      const safeChat = assertInteger(chatId, "chat id");
      return deleteSession(safeEmployee, safeChat);
    },
  );
}

// --- providers / skills ----------------------------------------------------------

function registerAgentEnvHandlers(): void {
  ipcMain.handle("providers:list", () => listProviders());
  ipcMain.handle("providers:listPage", (_event, page: unknown) =>
    listProvidersPage(parsePageQuery(page)),
  );
  ipcMain.handle("providers:upsert", async (_event, input: ProviderUpsert) => {
    // Persist the provider first, then refresh the app's model store so the
    // newly added/updated provider is immediately available. Best-effort:
    // a refresh failure is logged and never fails the save.
    await upsertProvider(input);
    await refreshModelStore(new AbortController().signal);
  });
  ipcMain.handle("providers:remove", async (_event, id: unknown) => {
    // Same for removal: keep the model store in sync after deleting a provider.
    await removeProvider(assertString(id, "provider id"));
    await refreshModelStore(new AbortController().signal);
  });
  ipcMain.handle("providers:listModels", (_event, input: unknown) =>
    listModels(input as ProviderModelsQuery),
  );
  // Full usable-model list from the shared ModelRuntime (built-in + custom,
  // auth-configured only) — backs the default-model / employee model selects.
  ipcMain.handle("models:list", () => listAvailableModels());
  ipcMain.handle("providers:copyKey", async (_event, id: unknown) => {
    const key = await revealProviderKey(assertString(id, "provider id"));
    if (!key) throw new Error("No API key set for this provider.");
    clipboard.writeText(key);
    return true;
  });

  ipcMain.handle("skills:list", () => listSkills());
  ipcMain.handle("skills:listPage", (_event, page: unknown) =>
    listSkillsPage(parsePageQuery(page)),
  );
  ipcMain.handle("skills:install", async () => {
    const paths = await pickSkillFolders();
    if (paths === null) return null;
    const imported = await installSkillsFromFolders(paths);
    if (imported.length > 0) broadcast("skills:changed");
    return imported;
  });
  ipcMain.handle("skills:uninstall", async (_event, name: unknown) => {
    await uninstallSkill(assertString(name, "skill name"));
    broadcast("skills:changed");
  });
}

// --- MCP servers -------------------------------------------------------------------

function registerMcpHandlers(): void {
  ipcMain.handle("mcp:list", () => mcpService.listMcpServers());
  ipcMain.handle("mcp:listPage", (_event, page: unknown) =>
    mcpService.listMcpServersPage(parsePageQuery(page)),
  );
  ipcMain.handle("mcp:get", (_event, id: unknown) =>
    mcpService.getMcpServer(assertInteger(id, "mcp id")),
  );
  ipcMain.handle("mcp:create", (_event, input: McpServerInput) =>
    mcpService.createMcpServer(input),
  );
  ipcMain.handle("mcp:update", (_event, id: unknown, input: McpServerInput) =>
    mcpService.updateMcpServer(assertInteger(id, "mcp id"), input),
  );
  ipcMain.handle("mcp:delete", (_event, id: unknown) =>
    mcpService.deleteMcpServer(assertInteger(id, "mcp id")),
  );
}

// --- theme -------------------------------------------------------------------------

function registerThemeHandlers(): void {
  ipcMain.handle("theme:get", () => getThemeState());

  ipcMain.handle("theme:set", (_event, patch: unknown) => {
    if (typeof patch !== "object" || patch === null) {
      throw new Error("theme patch must be an object.");
    }
    const record = patch as Record<string, unknown>;
    if (record["mode"] !== undefined) {
      const mode = sanitizeMode(
        typeof record["mode"] === "string" ? record["mode"] : undefined,
      );
      setThemeMode(mode);
    }
    if (record["color"] !== undefined) {
      if (typeof record["color"] !== "string") {
        throw new Error("theme color must be a string.");
      }
      setThemeColor(record["color"]);
    }
    const state = getThemeState();
    broadcast("theme:changed", state);
    return state;
  });
}

/**
 * Open a directory picker (attached to the focused window when available)
 * letting the user select multiple skill folders at once. Returns the chosen
 * paths, or `null` when the user cancels.
 */
async function pickSkillFolders(): Promise<string[] | null> {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options: Electron.OpenDialogOptions = {
    title: "Select skill folders",
    properties: ["openDirectory", "multiSelections"],
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
}

/** Call once after DB init: apply persisted mode + forward OS flips. */
export function setupNativeTheme(): void {
  initTheme();
  nativeTheme.on("updated", () => {
    broadcast("theme:changed", getThemeState());
  });
}

// --- helpers ---------------------------------------------------------------------

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  return value;
}

function assertInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${field} must be an integer.`);
  }
  return value;
}

/** Validate a `PageQuery` payload defensively (cursor/query strings, sane limit). */
function parsePageQuery(value: unknown): PageQuery {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("page query must be an object.");
  }
  const record = value as Record<string, unknown>;
  const page: PageQuery = {};
  if (record["cursor"] !== undefined && record["cursor"] !== null) {
    page.cursor = assertString(record["cursor"], "cursor");
  }
  if (record["query"] !== undefined && record["query"] !== null) {
    page.query = assertString(record["query"], "query");
  }
  if (record["limit"] !== undefined) {
    const limit = assertInteger(record["limit"], "limit");
    if (limit < 1 || limit > 200) {
      throw new Error("limit must be between 1 and 200.");
    }
    page.limit = limit;
  }
  return page;
}

/** Send an event to every live window (single-window app, kept for safety). */
function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}
