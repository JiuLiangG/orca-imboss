import type {
  IntegrationContactKind,
  IntegrationPlatform,
} from "@shared/types";
import { getIntegrationsPath } from "../data-dir";

/**
 * Persistence for IM integration config. Lives in a dedicated 0600
 * `~/.imboss/integrations.json` (atomic temp-file + rename), deliberately
 * separate from the CSV-exported `settings` table so bot secrets are never
 * included in a database export.
 */

export interface WechatConfig {
  enabled: boolean;
  /** iLink bot bearer token (secret). */
  botToken?: string;
  /** iLink account id, e.g. `hex@im.bot`. */
  accountId?: string;
  /** iLink API base URL returned at login. */
  baseUrl?: string;
  /** Whitelisted owner `ilink_user_id` (the account that scanned the QR). */
  userId?: string;
  /** Last long-poll cursor (`get_updates_buf`). */
  syncBuf?: string;
}

/** A discovered account, keyed by its personal account id. */
export interface ContactEntry {
  /** Display name, when the platform provides one. */
  name: string;
  /** Conversation the account was last seen in. */
  sessionId: string;
  kind: IntegrationContactKind;
  /** UNIX timestamp in milliseconds. */
  lastSeen: number;
}

export interface QqConfig {
  enabled: boolean;
  /** QQ Bot App ID. */
  appId?: string;
  /** QQ Bot App Secret (secret). */
  secret?: string;
  /** Whitelisted owner openids. */
  owners?: string[];
  /** Discovered accounts (owner picker), keyed by sender openid. */
  contacts?: Record<string, ContactEntry>;
}

export interface TelegramConfig {
  enabled: boolean;
  /** @BotFather bot token (secret). */
  botToken?: string;
  /** Whitelisted owner user ids. */
  owners?: string[];
  /** Last processed `update_id` + 1. */
  offset?: number;
  /** Discovered accounts (owner picker), keyed by sender user id. */
  contacts?: Record<string, ContactEntry>;
}

export interface IntegrationsFile {
  wechat?: WechatConfig;
  qq?: QqConfig;
  telegram?: TelegramConfig;
}

export type PlatformConfig = WechatConfig | QqConfig | TelegramConfig;

/** In-memory config store (mutated by the manager, persisted via `save`). */
let cache: IntegrationsFile | null = null;

/** Read the config file once, then serve the cached object. */
export async function loadIntegrations(): Promise<IntegrationsFile> {
  if (cache) return cache;
  cache = await readFileSafe(getIntegrationsPath());
  return cache;
}

/** The current in-memory config (loads on first access). */
export async function getIntegrations(): Promise<IntegrationsFile> {
  return loadIntegrations();
}

/** Persist the current in-memory config atomically. */
export async function saveIntegrations(): Promise<void> {
  if (!cache) return;
  await writeFileAtomic(getIntegrationsPath(), cache);
}

/** Replace the cached config (used by tests / reloads). */
export function setIntegrations(data: IntegrationsFile): void {
  cache = data;
}

/** Per-platform config object, creating a default when absent. */
export function configFor(
  data: IntegrationsFile,
  platform: IntegrationPlatform,
): PlatformConfig {
  switch (platform) {
    case "wechat":
      data.wechat ??= { enabled: false };
      return data.wechat;
    case "qq":
      data.qq ??= { enabled: false };
      return data.qq;
    case "telegram":
      data.telegram ??= { enabled: false };
      return data.telegram;
  }
}

async function readFileSafe(filePath: string): Promise<IntegrationsFile> {
  const { readFile, stat } = await import("fs/promises");
  try {
    await stat(filePath);
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return sanitize(parsed);
  } catch {
    // A corrupt config must never brick startup; treat as empty and let the
    // next save recreate it.
    return {};
  }
}

async function writeFileAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  const { writeFile, rename, chmod } = await import("fs/promises");
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, filePath);
  if (process.platform !== "win32") {
    try {
      await chmod(filePath, 0o600);
    } catch {
      // Best-effort hardening only.
    }
  }
}

/** Defensive shape check: drop anything that is not a plain object. */
function sanitize(value: unknown): IntegrationsFile {
  if (typeof value !== "object" || value === null) return {};
  const input = value as Record<string, unknown>;
  const out: IntegrationsFile = {};
  const wechat = asObject(input.wechat);
  if (wechat) out.wechat = wechat as unknown as WechatConfig;
  const qq = asObject(input.qq);
  if (qq) out.qq = qq as unknown as QqConfig;
  const telegram = asObject(input.telegram);
  if (telegram) out.telegram = telegram as unknown as TelegramConfig;
  return out;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
