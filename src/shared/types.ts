export interface SettingsPayload {
  locale: string;
}

// ---------------------------------------------------------------------------
// Paged lists (virtualized list panes)
// ---------------------------------------------------------------------------

/** One page returned by a keyset/cursor paginated list endpoint. */
export interface PageResult<T> {
  items: T[];
  /** Opaque keyset cursor for the next page; null when there are no more pages. */
  nextCursor: string | null;
  hasMore: boolean;
}

/** Query accepted by `*:listPage` IPC endpoints (all fields optional). */
export interface PageQuery {
  /** Opaque cursor from the previous page's nextCursor. */
  cursor?: string | null;
  /** Page size; default 50 (services clamp to a sane range). */
  limit?: number;
  /** Server-side filter/search term (semantics per module). */
  query?: string;
}

/** Value persisted per row in the `settings` table (key/value store). */
export type SettingKey = "locale" | `model.${string}`;

// ---------------------------------------------------------------------------
// Employees / chats / messages / sessions
// ---------------------------------------------------------------------------

/** Row of the `employees` table. Id 0 is the built-in assistant (reserved). */
export interface Employee {
  id: number;
  name: string;
  role: string;
  systemPrompt: string;
  /** Configured MCP server names (options come from `mcp:list`). */
  mcp: string[];
  skills: string[];
  modelId: string | null;
  /** Stored avatar file path (main-process only, may be null). */
  avatar: string | null;
  /** Avatar as a data URL for renderer display (may be null). */
  avatarUrl: string | null;
}

/** Input for creating/updating an employee (fields optional → untouched). */
export interface EmployeeInput {
  name?: string;
  role?: string;
  systemPrompt?: string;
  mcp?: string[];
  skills?: string[];
  modelId?: string | null;
}

/** Summary view of a chat row (includes unread count). */
export interface Chat {
  id: number;
  title: string;
  participants: number[];
  unread: number;
  /** UNIX timestamp in seconds (all date-kind fields are INTEGER seconds). */
  createdAt: number;
}

/** List item of the chat module: chat + derived last-message preview. */
export interface ChatSummary extends Chat {
  /** Last message content, truncated (null when the chat has no messages). */
  preview: string | null;
  /** UNIX timestamp in seconds of the last message (null when the chat has no messages). */
  lastAt: number | null;
}

/** Participant edits applied in one call (additive/removal merge). */
export interface ChatParticipantUpdate {
  add?: number[];
  remove?: number[];
}

export type MessageKind = "text" | "task_progress";

export type StepStatus = "done" | "busy";

/** One row of a progress card payload (kind = `task_progress`). */
export interface MessageStep {
  name: string;
  role: string;
  status: StepStatus;
}

/** Attachment metadata attached to a (user) message. */
export interface MessageAttachment {
  name: string;
  size: number;
  type: string;
  /** Optional data-URL preview (images only), size-capped. */
  preview: string | null;
}

/** Row of the `messages` table, ordered per chat by `created_at`. */
export interface Message {
  /** Global row id (monotonic; breaks same-second ties on ordering). */
  id: number;
  chatId: number;
  /** `null` when sent by the user or by the system. */
  senderEmployeeId: number | null;
  kind: MessageKind;
  content: string;
  /** Present when `kind` is `task_progress`. */
  steps: MessageStep[] | null;
  /** Present when the message carries attachments. */
  attachments: MessageAttachment[] | null;
  /** UNIX timestamp in seconds. */
  createdAt: number;
}

/** One hit from `messages:search` (FTS index or LIKE fallback). */
export interface MessageSearchResult {
  chatId: number;
  messageId: number;
  chatTitle: string;
  /** Content excerpt with the match wrapped in `«`/`»` markers. */
  snippet: string;
  /** UNIX timestamp in seconds. */
  createdAt: number;
}

/** Optional payload for `appendMessage` (all fields validated by the service). */
export interface AppendMessageOptions {
  kind?: MessageKind;
  steps?: MessageStep[];
  attachments?: MessageAttachment[];
}

/** Payload of the `chat:send` IPC (user → assistant placeholder pipeline). */
export interface SendChatPayload {
  chatId: number;
  content: string;
  attachments?: MessageAttachment[];
}

/** Row of the `sessions` table (one Pi session per employee per chat). */
export interface EmployeeSession {
  employeeId: number;
  chatId: number;
  session: string;
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

export const MCP_TRANSPORTS = ["stdio", "sse", "streamable-http"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/**
 * Transport-specific configuration payload. `stdio` spawns a command,
 * `sse` / `streamable-http` talk to a URL endpoint.
 */
export type McpConfig =
  | {
      transport: "stdio";
      command: string;
      args: string;
      env: Record<string, string>;
    }
  | { transport: "sse"; url: string; headers: Record<string, string> }
  | {
      transport: "streamable-http";
      url: string;
      headers: Record<string, string>;
    };

/** Row of the `mcp_servers` table. */
export interface McpServer {
  id: number;
  name: string;
  description: string;
  config: McpConfig;
}

/** Full-replacement input for `mcp_servers` create/update. */
export interface McpServerInput {
  name: string;
  description: string;
  config: McpConfig;
}

// ---------------------------------------------------------------------------
// Model providers (auth.json + models.json management)
// ---------------------------------------------------------------------------

/** Providers offered in the settings dropdown in addition to "Custom". */
export const CURATED_PROVIDERS = [
  "anthropic",
  "deepseek",
  "github-copilot",
  "google",
  "groq",
  "minimax-cn",
  "minimax",
  "moonshotai-cn",
  "moonshotai",
  "openai",
  "openrouter",
  "xai",
  "xiaomi",
  "zai",
] as const;

export const CURATED_PROVIDERS_LABELS = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  "github-copilot": "GitHub Copilot",
  google: "Google",
  groq: "Groq",
  "minimax-cn": "MiniMax (CN)",
  minimax: "MiniMax",
  "moonshotai-cn": "Moonshot AI (CN)",
  moonshotai: "Moonshot AI",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  xai: "xAI",
  xiaomi: "Xiaomi",
  zai: "Z.ai",
};

/** API protocol flavors supported for custom providers (`models.json` `api`). */
export const PROVIDER_API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;

export type ProviderApiType = (typeof PROVIDER_API_TYPES)[number];

/** Safe-to-render provider description (API keys are never included raw). */
export interface ProviderInfo {
  id: string;
  kind: "built-in" | "custom";
  label: string;
  baseUrl?: string;
  apiType?: ProviderApiType;
  modelIds: string[];
  hasKey: boolean;
  /** Last 4 characters of the stored key, for confirmation UI only. */
  keyHint: string | null;
}

/**
 * One usable model from the app's shared ModelRuntime (see main/agent/
 * model-runtime.ts). Combines built-in (dynamic catalog) and custom providers;
 * only models whose provider has configured auth are included.
 */
export interface ModelOption {
  provider: string;
  id: string;
  name: string;
}

/** Payload to add/update a provider configuration. */
export interface ProviderUpsert {
  id: string;
  kind: "built-in" | "custom";
  /** Required for custom providers; ignored for built-ins. */
  label?: string;
  baseUrl?: string;
  apiType?: ProviderApiType;
  modelIds?: string[];
  /** Omit to keep an existing key unchanged on update. */
  apiKey?: string;
}

/** Input to fetch a custom provider's available model ids (add-provider flow). */
export interface ProviderModelsQuery {
  baseUrl: string;
  apiType: ProviderApiType;
  apiKey: string;
}

// ---------------------------------------------------------------------------
// Theme & skills
// ---------------------------------------------------------------------------

export type ThemeMode = "light" | "dark" | "system";

/** State pushed/returned by the theme IPC (`theme:get` / `theme:set`). */
export interface ThemeState {
  mode: ThemeMode;
  /** 6-digit hex accent color, e.g. `#07C160`. */
  color: string;
}

/** An installed skill under `~/.imboss/agent/skills/<name>/SKILL.md`. */
export interface InstalledSkill {
  name: string;
  /** Parsed from SKILL.md frontmatter when available. */
  description: string | null;
}
