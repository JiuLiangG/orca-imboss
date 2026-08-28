import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
import type {
  ChatParticipantUpdate,
  Employee,
  EmployeeInput,
  McpServerInput,
  MessageAttachment,
  ProviderUpsert,
} from "../../shared/types";
import { deleteAvatarFiles, saveAvatar } from "../avatars";
import {
  listProviders,
  removeProvider,
  revealProviderKey,
  upsertProvider,
} from "../agent/providers";
import {
  installSkillFromFolder,
  listSkills,
  uninstallSkill,
} from "../agent/skills";
import { AgentSession } from "../agent/session";
import { getAgentEnvironment } from "../agent/environment";
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
   * Placeholder chat pipeline (decision 6): append the user message →
   * `AgentSession.prompt` (stub) → canned assistant reply appended after
   * ~480 ms → both writes broadcast `messages:changed`.
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

      // Canned reply (placeholder business logic — replaced by real agent later).
      const agentSession = new AgentSession(getAgentEnvironment());
      setTimeout(() => {
        void (async () => {
          try {
            await agentSession.prompt(safeContent);
            messagesService.appendMessage(
              safeChatId,
              employeesService.ASSISTANT_ID,
              "收到，已把任务拆解并派发给相关员工，完成后我会第一时间汇总给你。",
            );
            broadcast("messages:changed", safeChatId);
            broadcast("chats:summaries");
          } catch {
            // Chat may have been deleted before the reply lands; ignore.
          }
        })();
      }, 480);
      return userMessage;
    },
  );
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
  ipcMain.handle("providers:upsert", (_event, input: ProviderUpsert) =>
    upsertProvider(input),
  );
  ipcMain.handle("providers:remove", (_event, id: unknown) =>
    removeProvider(assertString(id, "provider id")),
  );
  ipcMain.handle("providers:revealKey", (_event, id: unknown) =>
    revealProviderKey(assertString(id, "provider id")),
  );

  ipcMain.handle("skills:list", () => listSkills());
  ipcMain.handle("skills:install", async () =>
    installFromDialog((path) => installSkillFromFolder(path)),
  );
  ipcMain.handle("skills:uninstall", async (_event, name: unknown) => {
    await uninstallSkill(assertString(name, "skill name"));
    broadcast("skills:changed");
  });
}

// --- MCP servers -------------------------------------------------------------------

function registerMcpHandlers(): void {
  ipcMain.handle("mcp:list", () => mcpService.listMcpServers());
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
 * and import the selected folder. Returns the installed entry name, or
 * `null` when the user cancels.
 */
async function installFromDialog(
  importFn: (path: string) => string | Promise<string>,
): Promise<string | null> {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options: Electron.OpenDialogOptions = {
    title: "Select skill folder",
    properties: ["openDirectory"],
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  const name = await importFn(result.filePaths[0]);
  broadcast("skills:changed");
  return name;
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

/** Send an event to every live window (single-window app, kept for safety). */
function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}
