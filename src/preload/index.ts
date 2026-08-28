import { contextBridge, ipcRenderer } from "electron";
import type {
  Chat,
  ChatParticipantUpdate,
  ChatSummary,
  Employee,
  EmployeeInput,
  EmployeeSession,
  InstalledSkill,
  McpServer,
  McpServerInput,
  Message,
  MessageAttachment,
  MessageSearchResult,
  ProviderInfo,
  ProviderUpsert,
  ThemeState,
} from "../shared/types";

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const runtimeLocale = readArg("locale") ?? "en";

const api = {
  locale: runtimeLocale,
  getLocale: () => ipcRenderer.invoke("locale:get") as Promise<string>,
  setLocale: (locale: string) =>
    ipcRenderer.invoke("locale:set", locale) as Promise<string>,
  onLocaleChanged: (cb: (locale: string) => void) => on("locale:changed", cb),
  settings: {
    get: (key: string) =>
      ipcRenderer.invoke("settings:get", key) as Promise<string | null>,
    set: (key: string, value: string) =>
      ipcRenderer.invoke("settings:set", key, value) as Promise<void>,
  },
  getVersion: () => ipcRenderer.invoke("app:getVersion") as Promise<string>,

  theme: {
    get: () => ipcRenderer.invoke("theme:get") as Promise<ThemeState>,
    set: (patch: Partial<ThemeState>) =>
      ipcRenderer.invoke("theme:set", patch) as Promise<ThemeState>,
    onChanged: (cb: (state: ThemeState) => void) => on("theme:changed", cb),
  },

  employees: {
    list: () => ipcRenderer.invoke("employees:list") as Promise<Employee[]>,
    create: (input: EmployeeInput) =>
      ipcRenderer.invoke("employees:create", input) as Promise<Employee>,
    update: (id: number, input: EmployeeInput) =>
      ipcRenderer.invoke(
        "employees:update",
        id,
        input,
      ) as Promise<Employee | null>,
    remove: (id: number) =>
      ipcRenderer.invoke("employees:delete", id) as Promise<boolean>,
    updateAvatar: (id: number, ext: string, data: Uint8Array) =>
      ipcRenderer.invoke(
        "employees:updateAvatar",
        id,
        ext,
        data,
      ) as Promise<Employee | null>,
  },

  chats: {
    list: () => ipcRenderer.invoke("chats:list") as Promise<Chat[]>,
    summaries: () =>
      ipcRenderer.invoke("chats:summaries") as Promise<ChatSummary[]>,
    markRead: (id: number) =>
      ipcRenderer.invoke("chats:markRead", id) as Promise<void>,
    create: (title: string, participants: number[]) =>
      ipcRenderer.invoke("chats:create", title, participants) as Promise<Chat>,
    update: (id: number, title: string) =>
      ipcRenderer.invoke("chats:update", id, title) as Promise<Chat | null>,
    updateParticipants: (id: number, changes: ChatParticipantUpdate) =>
      ipcRenderer.invoke(
        "chats:updateParticipants",
        id,
        changes,
      ) as Promise<Chat | null>,
    remove: (id: number) =>
      ipcRenderer.invoke("chats:delete", id) as Promise<boolean>,
  },

  messages: {
    list: (chatId: number) =>
      ipcRenderer.invoke("messages:list", chatId) as Promise<Message[]>,
    search: (query: string) =>
      ipcRenderer.invoke("messages:search", query) as Promise<
        MessageSearchResult[]
      >,
    append: (
      chatId: number,
      senderEmployeeId: number | null,
      content: string,
    ) =>
      ipcRenderer.invoke(
        "messages:append",
        chatId,
        senderEmployeeId,
        content,
      ) as Promise<Message>,
    onChanged: (cb: (chatId: number) => void) => on("messages:changed", cb),
  },

  chat: {
    send: (
      chatId: number,
      content: string,
      attachments?: MessageAttachment[],
    ) =>
      ipcRenderer.invoke(
        "chat:send",
        chatId,
        content,
        attachments,
      ) as Promise<Message>,
  },

  sessions: {
    get: (employeeId: number, chatId: number) =>
      ipcRenderer.invoke(
        "sessions:get",
        employeeId,
        chatId,
      ) as Promise<EmployeeSession | null>,
    set: (employeeId: number, chatId: number, sessionPath: string) =>
      ipcRenderer.invoke(
        "sessions:set",
        employeeId,
        chatId,
        sessionPath,
      ) as Promise<void>,
    remove: (employeeId: number, chatId: number) =>
      ipcRenderer.invoke(
        "sessions:delete",
        employeeId,
        chatId,
      ) as Promise<boolean>,
  },

  providers: {
    list: () => ipcRenderer.invoke("providers:list") as Promise<ProviderInfo[]>,
    upsert: (input: ProviderUpsert) =>
      ipcRenderer.invoke("providers:upsert", input) as Promise<void>,
    remove: (id: string) =>
      ipcRenderer.invoke("providers:remove", id) as Promise<void>,
    revealKey: (id: string) =>
      ipcRenderer.invoke("providers:revealKey", id) as Promise<string | null>,
  },

  mcp: {
    list: () => ipcRenderer.invoke("mcp:list") as Promise<McpServer[]>,
    create: (input: McpServerInput) =>
      ipcRenderer.invoke("mcp:create", input) as Promise<McpServer>,
    update: (id: number, input: McpServerInput) =>
      ipcRenderer.invoke("mcp:update", id, input) as Promise<McpServer | null>,
    remove: (id: number) =>
      ipcRenderer.invoke("mcp:delete", id) as Promise<boolean>,
  },

  skills: {
    list: () => ipcRenderer.invoke("skills:list") as Promise<InstalledSkill[]>,
    install: () =>
      ipcRenderer.invoke("skills:install") as Promise<string | null>,
    uninstall: (name: string) =>
      ipcRenderer.invoke("skills:uninstall", name) as Promise<void>,
    onChanged: (cb: () => void) => on("skills:changed", cb),
  },
};

export type IMB = typeof api;

contextBridge.exposeInMainWorld("imb", api);
