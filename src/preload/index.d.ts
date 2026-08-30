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
  PageQuery,
  PageResult,
  ProviderInfo,
  ProviderModelsQuery,
  ProviderUpsert,
  ThemeState,
} from "../shared/types";

interface IMB {
  platform: string;
  locale: string;
  getLocale(): Promise<string>;
  setLocale(locale: string): Promise<string>;
  onLocaleChanged(cb: (locale: string) => void): () => void;
  settings: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
  getVersion(): Promise<string>;

  windowControls: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximized(cb: (maximized: boolean) => void): () => void;
  };

  theme: {
    get(): Promise<ThemeState>;
    set(patch: Partial<ThemeState>): Promise<ThemeState>;
    onChanged(cb: (state: ThemeState) => void): () => void;
  };

  employees: {
    list(): Promise<Employee[]>;
    listPage(page: PageQuery): Promise<PageResult<Employee>>;
    create(input: EmployeeInput): Promise<Employee>;
    update(id: number, input: EmployeeInput): Promise<Employee | null>;
    remove(id: number): Promise<boolean>;
    updateAvatar(
      id: number,
      ext: string,
      data: Uint8Array,
    ): Promise<Employee | null>;
  };

  chats: {
    list(): Promise<Chat[]>;
    summaries(): Promise<ChatSummary[]>;
    summariesPage(page: PageQuery): Promise<PageResult<ChatSummary>>;
    markRead(id: number): Promise<void>;
    create(title: string, participants: number[]): Promise<Chat>;
    update(id: number, title: string): Promise<Chat | null>;
    updateParticipants(
      id: number,
      changes: ChatParticipantUpdate,
    ): Promise<Chat | null>;
    remove(id: number): Promise<boolean>;
  };

  messages: {
    list(chatId: number): Promise<Message[]>;
    search(query: string): Promise<MessageSearchResult[]>;
    append(
      chatId: number,
      senderEmployeeId: number | null,
      content: string,
    ): Promise<Message>;
    onChanged(cb: (chatId: number) => void): () => void;
  };

  chat: {
    send(
      chatId: number,
      content: string,
      attachments?: MessageAttachment[],
    ): Promise<Message>;
  };

  sessions: {
    get(employeeId: number, chatId: number): Promise<EmployeeSession | null>;
    set(employeeId: number, chatId: number, sessionPath: string): Promise<void>;
    remove(employeeId: number, chatId: number): Promise<boolean>;
  };

  providers: {
    list(): Promise<ProviderInfo[]>;
    listPage(page: PageQuery): Promise<PageResult<ProviderInfo>>;
    upsert(input: ProviderUpsert): Promise<void>;
    remove(id: string): Promise<void>;
    copyKey(id: string): Promise<boolean>;
    listModels(input: ProviderModelsQuery): Promise<string[]>;
  };

  mcp: {
    list(): Promise<McpServer[]>;
    listPage(page: PageQuery): Promise<PageResult<McpServer>>;
    create(input: McpServerInput): Promise<McpServer>;
    update(id: number, input: McpServerInput): Promise<McpServer | null>;
    remove(id: number): Promise<boolean>;
  };

  skills: {
    list(): Promise<InstalledSkill[]>;
    listPage(page: PageQuery): Promise<PageResult<InstalledSkill>>;
    install(): Promise<string[] | null>;
    uninstall(name: string): Promise<void>;
    onChanged(cb: () => void): () => void;
  };
}

declare global {
  declare const imb: IMB;

  interface Window {
    imb: IMB;
  }
}

export {};
