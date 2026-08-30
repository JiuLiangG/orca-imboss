import type {
  McpConfig,
  McpServer,
  McpServerInput,
  McpTransport,
  PageQuery,
  PageResult,
} from "../../../shared/types";
import { MCP_TRANSPORTS } from "../../../shared/types";
import { getDB } from "../index";
import { parseJsonObject } from "./json";
import { escapeLike } from "./text-search";

/**
 * `mcp_servers` service — prototype-level MCP server configuration storage.
 * Runtime wiring is deferred; the data layer owns the config (single source
 * of truth for the future agent runtime).
 *
 * Stored shape: one `transport` column + one transport-specific `config` JSON
 * (stdio → `{command, args, env}`; sse/streamable-http → `{url, headers}`).
 * Reads always reconstruct the discriminated `McpConfig` union.
 */

interface McpRow {
  id: number;
  name: string;
  description: string;
  transport: string;
  config: string;
}

const MAX_NAME_LENGTH = 200;
const MAX_DESC_LENGTH = 2000;
const MAX_COMMAND_LENGTH = 2048;
const MAX_ARGS_LENGTH = 8192;
const MAX_URL_LENGTH = 2048;
const MAX_ENTRIES = 128;
const MAX_KEY_LENGTH = 256;
const MAX_VALUE_LENGTH = 4096;

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isTransport(value: unknown): value is McpTransport {
  return (
    typeof value === "string" &&
    (MCP_TRANSPORTS as readonly string[]).includes(value)
  );
}

/**
 * Read a string with a length cap; missing/wrong types degrade to "".
 */
function readString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Read a string→string record with entry caps; wrong shapes degrade to {}.
 */
function readStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, val] of entries.slice(0, MAX_ENTRIES)) {
    result[key.slice(0, MAX_KEY_LENGTH)] =
      typeof val === "string" ? val.slice(0, MAX_VALUE_LENGTH) : "";
  }
  return result;
}

function toConfig(row: McpRow): McpConfig {
  const transport: McpTransport = isTransport(row.transport)
    ? row.transport
    : "stdio";
  const parsed = parseJsonObject(row.config);
  if (transport === "stdio") {
    return {
      transport,
      command: readString(parsed["command"], MAX_COMMAND_LENGTH),
      args: readString(parsed["args"], MAX_ARGS_LENGTH),
      env: readStringRecord(parsed["env"]),
    };
  }
  return {
    transport,
    url: readString(parsed["url"], MAX_URL_LENGTH),
    headers: readStringRecord(parsed["headers"]),
  };
}

function toMcpServer(row: McpRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config: toConfig(row),
  };
}

function validateName(name: string): string {
  const safe = name.trim();
  if (safe.length === 0) throw new Error("MCP name is required.");
  if (safe.length > MAX_NAME_LENGTH) throw new Error("MCP name is too long.");
  return safe;
}

function validateDescription(description: string): string {
  if (typeof description !== "string" || description.length > MAX_DESC_LENGTH) {
    throw new Error("MCP description is too long.");
  }
  return description;
}

function validateConfig(input: McpConfig): McpConfig {
  if (typeof input !== "object" || input === null) {
    throw new Error("MCP config is required.");
  }
  if (input.transport === "stdio") {
    const command = input.command ? input.command.trim() : "";
    if (command.length === 0) {
      throw new Error("A start command is required for stdio servers.");
    }
    if (command.length > MAX_COMMAND_LENGTH) {
      throw new Error("Command is too long.");
    }
    const args = typeof input.args === "string" ? input.args : "";
    if (args.length > MAX_ARGS_LENGTH) {
      throw new Error("Command arguments are too long.");
    }
    const env = validateRecord(input.env, "env", ENV_KEY_RE);
    return { transport: "stdio", command, args, env };
  }
  const url = typeof input.url === "string" ? input.url.trim() : "";
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
  const headers = validateRecord(input.headers, "headers");
  return { transport: input.transport, url, headers };
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

/** Serialize config minus the transport field (column owns it). */
function configToJson(config: McpConfig): string {
  const transport = config.transport;
  if (transport === "stdio") {
    return JSON.stringify({
      command: config.command,
      args: config.args,
      env: config.env,
    });
  }
  return JSON.stringify({ url: config.url, headers: config.headers });
}

const SELECT_ALL = "SELECT * FROM mcp_servers ORDER BY id ASC";
const SELECT_BY_ID = "SELECT * FROM mcp_servers WHERE id = ?";

export function listMcpServers(): McpServer[] {
  return (getDB().prepare(SELECT_ALL).all() as McpRow[]).map(toMcpServer);
}

// --- paged MCP list (keyset cursor over `id ASC`) ---------------------------

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/**
 * One page of MCP servers, ordered `id ASC` (unchanged from the full list).
 * Search = `LIKE` on `name OR description` (ESCAPE-safe). Keyset seek on
 * `id > ?` keeps scrolling stable under concurrent inserts.
 */
export function listMcpServersPage(
  page: PageQuery = {},
): PageResult<McpServer> {
  const limit = Math.min(
    Math.max(Math.trunc(page.limit ?? DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );
  const needle = (page.query ?? "").trim();
  const db = getDB();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (page.cursor) {
    const cursorId = Number(page.cursor);
    if (Number.isSafeInteger(cursorId) && cursorId > 0) {
      conditions.push("id > ?");
      params.push(cursorId);
    }
  }
  if (needle.length > 0) {
    const pattern = `%${escapeLike(needle)}%`;
    conditions.push(
      "(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')",
    );
    params.push(pattern, pattern);
  }

  const rows = db
    .prepare(
      `SELECT * FROM mcp_servers
       WHERE ${conditions.length > 0 ? conditions.join(" AND ") : "1 = 1"}
       ORDER BY id ASC
       LIMIT ?`,
    )
    .all(...params, limit + 1) as McpRow[];

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(toMcpServer);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? String(last.id) : null,
    hasMore,
  };
}

export function getMcpServer(id: number): McpServer | null {
  const row = getDB().prepare(SELECT_BY_ID).get(id) as McpRow | undefined;
  return row ? toMcpServer(row) : null;
}

/** Create an MCP server. `env` keys must look like env-var names (defensive). */
export function createMcpServer(input: McpServerInput): McpServer {
  const config = validateConfig(input.config);
  const result = getDB()
    .prepare(
      "INSERT INTO mcp_servers (name, description, transport, config) VALUES (?, ?, ?, ?)",
    )
    .run(
      validateName(input.name),
      validateDescription(input.description ?? ""),
      config.transport,
      configToJson(config),
    );
  const created = getMcpServer(Number(result.lastInsertRowid));
  if (!created) throw new Error("Failed to create MCP server.");
  return created;
}

/** Replace an MCP server's full configuration. */
export function updateMcpServer(
  id: number,
  input: McpServerInput,
): McpServer | null {
  const config = validateConfig(input.config);
  getDB()
    .prepare(
      "UPDATE mcp_servers SET name = ?, description = ?, transport = ?, config = ? WHERE id = ?",
    )
    .run(
      validateName(input.name),
      validateDescription(input.description ?? ""),
      config.transport,
      configToJson(config),
      id,
    );
  return getMcpServer(id);
}

export function deleteMcpServer(id: number): boolean {
  return (
    getDB().prepare("DELETE FROM mcp_servers WHERE id = ?").run(id).changes > 0
  );
}
