import { MCP_TRANSPORTS } from "@shared/constants/mcp";
import type {
  McpConfig,
  McpServer,
  McpServerInput,
  McpTransport,
} from "@shared/types";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { getAgentRoot } from "./data-dir";

/**
 * `mcp.json` service — the single source of truth for MCP server
 * configuration, stored in the app's isolated agent dir
 * (`~/.imboss/agent/mcp.json`).
 *
 * The format matches the Pi SDK / other MCP clients:
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "filesystem": { "command": "npx", "args": ["-y", "..."] },
 *     "docs": { "url": "https://example.com/mcp", "headers": {} }
 *   }
 * }
 * ```
 *
 * Design (defensive):
 * - Reads never throw: a missing/corrupt file degrades to an empty list so a
 *   bad config can never break agent sessions.
 * - Writes are atomic (temp file + rename) and keep unrelated top-level keys
 *   and unknown per-server fields intact.
 * - The file holds secrets (env, headers), so it is written with mode 0600
 *   inside the already-isolated (0700) agent root.
 */

/** The app's internal `McpConfig` args are a single string for the UI form. */
const MAX_DESC_LENGTH = 2000;
const MAX_COMMAND_LENGTH = 2048;
const MAX_ARGS_LENGTH = 8192;
const MAX_URL_LENGTH = 2048;
const MAX_ENTRIES = 128;
const MAX_KEY_LENGTH = 256;
const MAX_VALUE_LENGTH = 4096;

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Server names accepted by the SDK: letters, digits, `_`, `-` only. */
const NAME_RE = /^[A-Za-z0-9_-]{1,200}$/;

/** Absolute path of the app's `mcp.json`. */
export function getMcpConfigPath(): string {
  return join(getAgentRoot(), "mcp.json");
}

/** Read the whole file; missing/corrupt content degrades to an empty doc. */
function loadDoc(): {
  root: Record<string, unknown>;
  servers: Record<string, unknown>;
} {
  const path = getMcpConfigPath();
  if (!existsSync(path)) return { root: {}, servers: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(
      "[mcp] failed to parse mcp.json:",
      err instanceof Error ? err.message : err,
    );
    return { root: {}, servers: {} };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { root: {}, servers: {} };
  }
  const root = parsed as Record<string, unknown>;
  const rawServers = root["mcpServers"];
  const servers =
    typeof rawServers === "object" &&
    rawServers !== null &&
    !Array.isArray(rawServers)
      ? (rawServers as Record<string, unknown>)
      : {};
  return { root, servers };
}

/** Atomic write of the whole document (0600). */
function saveDoc(
  root: Record<string, unknown>,
  servers: Record<string, unknown>,
): void {
  const path = getMcpConfigPath();
  const next = { ...root, mcpServers: servers };
  const content = `${JSON.stringify(next, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

/** Every configured server, normalised and sorted by name. */
export function readMcpServers(): McpServer[] {
  const { servers } = loadDoc();
  const result: McpServer[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    const server = toMcpServer(name, raw);
    if (server) result.push(server);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** Create a new server. Throws when the name already exists or is invalid. */
export function createMcpServer(input: McpServerInput): McpServer {
  const {
    name: rawName,
    description: rawDescription,
    config: rawConfig,
  } = readInput(input);
  const name = validateName(rawName);
  const description = validateDescription(rawDescription ?? "");
  const config = validateConfig(rawConfig);
  const { root, servers } = loadDoc();
  if (Object.prototype.hasOwnProperty.call(servers, name)) {
    throw new Error(`An MCP server named "${name}" already exists.`);
  }
  servers[name] = toFileEntry(config, description, undefined);
  saveDoc(root, servers);
  return { name, description, config };
}

/**
 * Replace a server's configuration. Renaming is allowed when the new name is
 * free. Unknown fields of the edited entry (e.g. `enabled`, `exposure`,
 * `timeout`, `cwd`) are preserved; fields belonging to the other transport are
 * dropped when the transport changes.
 */
export function updateMcpServer(
  currentName: string,
  input: McpServerInput,
): McpServer | null {
  const {
    name: rawName,
    description: rawDescription,
    config: rawConfig,
  } = readInput(input);
  const name = validateName(rawName);
  const description = validateDescription(rawDescription ?? "");
  const config = validateConfig(rawConfig);
  const { root, servers } = loadDoc();
  if (!Object.prototype.hasOwnProperty.call(servers, currentName)) return null;
  if (
    name !== currentName &&
    Object.prototype.hasOwnProperty.call(servers, name)
  ) {
    throw new Error(`An MCP server named "${name}" already exists.`);
  }
  const previous = servers[currentName];
  delete servers[currentName];
  servers[name] = toFileEntry(config, description, previous);
  saveDoc(root, servers);
  return { name, description, config };
}

/** Remove a server by name. Returns false when it does not exist. */
export function deleteMcpServer(name: string): boolean {
  const { root, servers } = loadDoc();
  if (!Object.prototype.hasOwnProperty.call(servers, name)) return false;
  delete servers[name];
  saveDoc(root, servers);
  return true;
}

/**
 * Raw `mcpServers` entries exactly as stored on disk, unknown per-server
 * fields included. Used by the employee export, which must reproduce the
 * configured server rather than the normalised view.
 */
export function readMcpRawEntries(): Record<string, unknown> {
  const { servers } = loadDoc();
  return { ...servers };
}

/** Whole-file text snapshot of `mcp.json` (null when it does not exist). */
export function snapshotMcpConfig(): string | null {
  try {
    return readFileSync(getMcpConfigPath(), "utf8");
  } catch {
    return null;
  }
}

/**
 * Atomically restore a snapshot taken by `snapshotMcpConfig` (null = the file
 * did not exist, so it is removed again). Used to roll back a failed import.
 */
export function restoreMcpConfig(snapshot: string | null): void {
  const path = getMcpConfigPath();
  if (snapshot === null) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, snapshot, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

/** Result of merging imported servers into `mcp.json`. */
export interface McpImportResult {
  /** Servers that did not exist locally and were written. */
  added: string[];
  /** Servers that existed locally and were replaced (overwrite requested). */
  overwritten: string[];
  /** Servers left untouched because they already existed. */
  kept: string[];
  /** Entries dropped as invalid (bad name / not a command-or-url entry). */
  invalid: string[];
}

/**
 * Merge raw `mcp.json` entries (e.g. from an employee export) into the local
 * config. Validation reuses the same rules as the CRUD path; unknown
 * per-server fields travel along. Unrelated top-level keys and unrelated
 * servers are untouched, and the write stays atomic (temp file + rename).
 */
export function importMcpEntries(
  entries: Record<string, unknown>,
  options: { overwrite: boolean },
): McpImportResult {
  const result: McpImportResult = {
    added: [],
    overwritten: [],
    kept: [],
    invalid: [],
  };
  const { root, servers } = loadDoc();
  let changed = false;

  for (const [rawName, rawEntry] of Object.entries(entries)) {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const normalized = NAME_RE.test(name) ? toMcpServer(name, rawEntry) : null;
    if (!normalized || !isImportableConfig(normalized.config)) {
      result.invalid.push(typeof rawName === "string" ? rawName : "");
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(servers, name)) {
      if (!options.overwrite) {
        result.kept.push(name);
        continue;
      }
      result.overwritten.push(name);
    } else {
      result.added.push(name);
    }
    // `previous` keeps unknown fields while the transport-owned ones are
    // rewritten from the validated config.
    servers[name] = toFileEntry(
      normalized.config,
      normalized.description,
      rawEntry,
    );
    changed = true;
  }

  if (changed) saveDoc(root, servers);
  return result;
}

// ---------------------------------------------------------------------------
// normalisation / validation
// ---------------------------------------------------------------------------

/**
 * Stricter checks for an entry coming from outside (an employee export): the
 * reader is lenient by design, but a server we *write* into `mcp.json` must
 * satisfy the same rules the CRUD form enforces, or the UI could no longer
 * edit it.
 */
function isImportableConfig(config: McpConfig): boolean {
  if (config.transport === "stdio") {
    if (config.command.length === 0) return false;
    return Object.keys(config.env).every((key) => ENV_KEY_RE.test(key));
  }
  try {
    const parsed = new URL(config.url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

/** Defensively unpack a create/update payload coming from IPC. */
function readInput(input: unknown): {
  name: unknown;
  description: unknown;
  config: unknown;
} {
  if (typeof input !== "object" || input === null) {
    throw new Error("MCP server input is required.");
  }
  const record = input as Record<string, unknown>;
  return {
    name: record["name"],
    description: record["description"],
    config: record["config"],
  };
}

function toMcpServer(name: string, raw: unknown): McpServer | null {
  if (!NAME_RE.test(name)) return null;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const description = readString(entry["description"], MAX_DESC_LENGTH);
  if (typeof entry["command"] === "string") {
    return {
      name,
      description,
      config: {
        transport: "stdio",
        command: readString(entry["command"], MAX_COMMAND_LENGTH),
        args: readArgs(entry["args"]),
        env: readStringRecord(entry["env"]),
      },
    };
  }
  if (typeof entry["url"] === "string") {
    return {
      name,
      description,
      config: {
        transport: "http",
        url: readString(entry["url"], MAX_URL_LENGTH),
        headers: readStringRecord(entry["headers"]),
      },
    };
  }
  return null;
}

/**
 * Build a `mcp.json` entry from validated config + description. `previous` (the
 * old raw entry, when updating) supplies preserved unknown fields.
 */
function toFileEntry(
  config: McpConfig,
  description: string,
  previous: unknown,
): Record<string, unknown> {
  const preserved: Record<string, unknown> =
    typeof previous === "object" &&
    previous !== null &&
    !Array.isArray(previous)
      ? { ...(previous as Record<string, unknown>) }
      : {};
  // Drop fields owned by the other transport so a switch cannot leave both.
  for (const key of ["command", "args", "env", "url", "headers"]) {
    delete preserved[key];
  }
  if (description) {
    preserved["description"] = description;
  } else {
    delete preserved["description"];
  }
  if (config.transport === "stdio") {
    preserved["command"] = config.command;
    const args = parseMcpArgs(config.args);
    if (args.length > 0) preserved["args"] = args;
    else delete preserved["args"];
    if (Object.keys(config.env).length > 0) preserved["env"] = config.env;
    else delete preserved["env"];
  } else {
    preserved["url"] = config.url;
    if (Object.keys(config.headers).length > 0) {
      preserved["headers"] = config.headers;
    } else {
      delete preserved["headers"];
    }
  }
  return preserved;
}

function isTransport(value: unknown): value is McpTransport {
  return (
    typeof value === "string" &&
    (MCP_TRANSPORTS as readonly string[]).includes(value)
  );
}

/** Read a string with a length cap; missing/wrong types degrade to "". */
function readString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/** Read the stdio `args` array into the app's shell-like single string. */
function readArgs(value: unknown): string {
  if (Array.isArray(value)) {
    return formatMcpArgs(
      value
        .filter((arg): arg is string => typeof arg === "string")
        .slice(0, MAX_ENTRIES),
    ).slice(0, MAX_ARGS_LENGTH);
  }
  // Legacy/string args are accepted verbatim.
  return readString(value, MAX_ARGS_LENGTH);
}

/** Read a string→string record with entry caps; wrong shapes degrade to {}. */
function readStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, val] of entries.slice(0, MAX_ENTRIES)) {
    if (typeof val !== "string") continue;
    result[key.slice(0, MAX_KEY_LENGTH)] = val.slice(0, MAX_VALUE_LENGTH);
  }
  return result;
}

function validateName(name: unknown): string {
  const safe = typeof name === "string" ? name.trim() : "";
  if (safe.length === 0) throw new Error("MCP name is required.");
  if (!NAME_RE.test(safe)) {
    throw new Error(
      "MCP name may only contain letters, digits, underscores and dashes.",
    );
  }
  return safe;
}

function validateDescription(description: unknown): string {
  if (typeof description !== "string" || description.length > MAX_DESC_LENGTH) {
    throw new Error("MCP description is too long.");
  }
  return description;
}

function validateConfig(input: unknown): McpConfig {
  if (typeof input !== "object" || input === null) {
    throw new Error("MCP config is required.");
  }
  const record = input as Record<string, unknown>;
  const transport = record["transport"];
  if (!isTransport(transport)) {
    throw new Error("Unknown MCP transport.");
  }
  if (transport === "stdio") {
    const command =
      typeof record["command"] === "string"
        ? (record["command"] as string).trim()
        : "";
    if (command.length === 0) {
      throw new Error("A start command is required for stdio servers.");
    }
    if (command.length > MAX_COMMAND_LENGTH) {
      throw new Error("Command is too long.");
    }
    const args = typeof record["args"] === "string" ? record["args"] : "";
    if (args.length > MAX_ARGS_LENGTH) {
      throw new Error("Command arguments are too long.");
    }
    const env = validateRecord(
      record["env"] as Record<string, string>,
      "env",
      ENV_KEY_RE,
    );
    return { transport: "stdio", command, args, env };
  }
  const url =
    typeof record["url"] === "string" ? (record["url"] as string).trim() : "";
  if (url.length === 0) {
    throw new Error("A URL is required for this transport.");
  }
  if (url.length > MAX_URL_LENGTH) {
    throw new Error("URL is too long.");
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("bad protocol");
    }
  } catch {
    throw new Error("URL must be a valid http(s) URL.");
  }
  const headers = validateRecord(
    record["headers"] as Record<string, string>,
    "headers",
  );
  return { transport: "http", url, headers };
}

function validateRecord(
  record: Record<string, string> | undefined,
  field: string,
  keyPattern?: RegExp,
): Record<string, string> {
  if (record == null) return {};
  if (typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`${field} must be an object.`);
  }
  const entries = Object.entries(record);
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`Too many ${field} entries.`);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
      throw new Error(`${field} key has invalid length.`);
    }
    if (keyPattern && !keyPattern.test(key)) {
      throw new Error(`${field} key must look like an env-var name.`);
    }
    if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH) {
      throw new Error(`${field} value has invalid length or type.`);
    }
    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// command-argument string <-> argv
// ---------------------------------------------------------------------------

/**
 * Parse a stored command-arguments string into an argv array.
 *
 * Basic shell-like splitting with no variable expansion:
 * - whitespace separates tokens;
 * - single/double quotes group (quotes are removed);
 * - a backslash escapes the next character (outside single quotes).
 * Unbalanced quotes are taken literally (defensive; never throws).
 */
export function parseMcpArgs(args: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let quote: "'" | '"' | null = null;
  const flush = (): void => {
    if (hasToken) {
      tokens.push(current);
      current = "";
      hasToken = false;
    }
  };
  let i = 0;
  const n = args.length;
  while (i < n) {
    const ch = args[i];
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"') {
        if (i + 1 < n) {
          current += args[i + 1];
          i += 1;
        } else {
          current += ch;
        }
      } else {
        current += ch;
      }
      hasToken = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      flush();
      quote = ch;
      hasToken = true;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      if (i + 1 < n) {
        current += args[i + 1];
        hasToken = true;
        i += 1;
      } else {
        current += ch;
        hasToken = true;
      }
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      i += 1;
      continue;
    }
    current += ch;
    hasToken = true;
    i += 1;
  }
  flush();
  return tokens;
}

/**
 * Serialise argv into the app's single-line form so `parseMcpArgs` can
 * reconstruct the same array. Tokens containing whitespace/quotes/backslashes
 * are double-quoted (round-trip safe for realistic arguments).
 */
export function formatMcpArgs(args: string[]): string {
  return args
    .map((arg) => {
      if (arg.length === 0) return '""';
      if (!/[\s"'\\]/.test(arg)) return arg;
      return `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    })
    .join(" ");
}
