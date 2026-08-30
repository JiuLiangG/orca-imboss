import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type ContentBlock,
  type Tool as McpTool,
  type Transport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Type, type TSchema } from "typebox";
import type {
  AgentToolResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { McpConfig, McpServer } from "../../shared/types";
import { mergeEnv, readUserEnv } from "./user-env";

/** Shared Pi tool definition type (any params/details — variance-safe). */
export type AnyPiTool = ToolDefinition<any, any, any>;

/**
 * App-side MCP client bridge.
 *
 * Pi has no native MCP support, so each configured `McpServer` is connected
 * by this module (stdio / sse / streamable-http) and its tools are surfaced
 * to the Pi session as custom tools. Design decisions (confirmed):
 *
 * - **stdio**: the server command is spawned with
 *   `{ ...process.env, ...userEnv, ...serverEnv }` — user-configured env vars
 *   (with `$VAR`/`${VAR}` expansion) apply to the MCP subprocess too.
 * - **HTTP transports** (`sse` / `streamable-http`): the per-server URL and
 *   `headers` are used **verbatim**; user env is NOT applied (no subprocess).
 * - A failing server connect logs and skips that server — it must never break
 *   the agent session.
 */

const CONNECT_TIMEOUT_MS = 20_000;
const MAX_TOOL_NAME_LENGTH = 128;
const MAX_SCHEMA_DEPTH = 6;

// ---------------------------------------------------------------------------
// stdio argv parsing
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
      // Escape the next char into the current token (no flush).
      if (i + 1 < n) {
        current += args[i + 1];
        hasToken = true;
        i += 1;
      } else {
        // Trailing backslash kept literal.
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

// ---------------------------------------------------------------------------
// transport construction
// ---------------------------------------------------------------------------

/** Build the client transport for one server config (env merged for stdio). */
export function buildMcpTransport(config: McpConfig): Transport {
  if (config.transport === "stdio") {
    return new StdioClientTransport({
      command: config.command,
      args: parseMcpArgs(config.args),
      // More specific wins: process env → user env → per-server env.
      env: mergeEnv(
        process.env as Record<string, string>,
        readUserEnv(),
        config.env,
      ),
    });
  }
  if (config.transport === "sse") {
    return new SSEClientTransport(new URL(config.url), {
      requestInit: { headers: { ...config.headers } },
    });
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: { ...config.headers } },
  });
}

/** Connect the client; fail (and close the transport) after a bounded wait. */
async function connectWithTimeout(
  client: Client,
  transport: Transport,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void transport.close().catch(() => undefined);
      reject(
        new Error(
          `MCP server did not answer within ${CONNECT_TIMEOUT_MS}ms.`,
        ),
      );
    }, CONNECT_TIMEOUT_MS);
  });
  try {
    await Promise.race([client.connect(transport), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// JSON Schema → TypeBox
// ---------------------------------------------------------------------------

/**
 * Best-effort JSON Schema → TypeBox conversion for MCP tool parameters.
 *
 * Covers the constructs MCP servers commonly emit (object/array/string/
 * number/boolean/null, enum/const, anyOf/oneOf, required + length caps).
 * Unsupported constructs degrade to `Type.Unknown()` so the tool stays
 * callable — argument semantics remain enforced by the MCP server itself.
 */
export function jsonSchemaToTypeBox(schema: unknown, depth = 0): TSchema {
  if (depth > MAX_SCHEMA_DEPTH) return Type.Unknown();
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return Type.Unknown();
  }
  const s = schema as Record<string, unknown>;
  const type = typeof s["type"] === "string" ? (s["type"] as string) : undefined;

  if ("const" in s) return literalSchema(s["const"]);

  if (Array.isArray(s["enum"])) {
    const values = s["enum"] as unknown[];
    if (values.length === 0) return Type.Unknown();
    if (values.length === 1) return literalSchema(values[0]);
    return Type.Union(values.map((v) => literalSchema(v)));
  }

  for (const key of ["anyOf", "oneOf"] as const) {
    const list = s[key];
    if (Array.isArray(list) && list.length > 0) {
      const parts = list.map((part) => jsonSchemaToTypeBox(part, depth + 1));
      return parts.length === 1 ? parts[0] : Type.Union(parts);
    }
  }

  if (Array.isArray(s["allOf"]) && s["allOf"].length > 0) {
    const merged: Record<string, unknown> = {};
    let mergable = true;
    for (const part of s["allOf"] as unknown[]) {
      const boxed = jsonSchemaToTypeBox(part, depth + 1);
      if (
        typeof boxed === "object" &&
        boxed !== null &&
        (boxed as { type?: unknown }).type === "object" &&
        typeof (boxed as { properties?: unknown }).properties === "object"
      ) {
        Object.assign(merged, (boxed as { properties: unknown }).properties);
      } else {
        mergable = false;
        break;
      }
    }
    if (mergable) return objectSchema(merged, [], s);
    return Type.Unknown();
  }

  switch (type) {
    case "object": {
      const properties =
        typeof s["properties"] === "object" && s["properties"] !== null
          ? (s["properties"] as Record<string, unknown>)
          : {};
      const required = Array.isArray(s["required"])
        ? (s["required"] as unknown[]).filter(
            (name): name is string => typeof name === "string",
          )
        : [];
      return objectSchema(properties, required, s);
    }
    case "array": {
      const items =
        s["items"] !== undefined
          ? jsonSchemaToTypeBox(s["items"], depth + 1)
          : Type.Unknown();
      return Type.Array(items, {
        ...(typeof s["minItems"] === "number" ? { minItems: s["minItems"] } : {}),
        ...(typeof s["maxItems"] === "number" ? { maxItems: s["maxItems"] } : {}),
      });
    }
    case "string":
      return Type.String({
        ...(typeof s["minLength"] === "number" ? { minLength: s["minLength"] } : {}),
        ...(typeof s["maxLength"] === "number" ? { maxLength: s["maxLength"] } : {}),
      });
    case "number":
      return Type.Number();
    case "integer":
      return Type.Integer();
    case "boolean":
      return Type.Boolean();
    case "null":
      return Type.Null();
    default:
      return Type.Unknown();
  }
}

function literalSchema(value: unknown): TSchema {
  if (typeof value === "string") return Type.Literal(value);
  if (typeof value === "number") return Type.Literal(value);
  if (typeof value === "boolean") return Type.Literal(value);
  if (value === null) return Type.Null();
  return Type.Unknown();
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
  raw: Record<string, unknown>,
): TSchema {
  const props: Record<string, TSchema> = {};
  const requiredSet = new Set(required);
  for (const [key, propSchema] of Object.entries(properties)) {
    const boxed = jsonSchemaToTypeBox(propSchema);
    props[key] = requiredSet.has(key) ? boxed : Type.Optional(boxed);
  }
  return raw["additionalProperties"] === false
    ? Type.Object(props, { additionalProperties: false })
    : Type.Object(props);
}

// ---------------------------------------------------------------------------
// tool result mapping
// ---------------------------------------------------------------------------

/** Extract plain text from MCP result content blocks (best effort). */
function mcpContentToText(content: ContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else {
      parts.push(JSON.stringify(block));
    }
  }
  return parts.join("\n").trim();
}

/**
 * Map MCP result content into Pi's `AgentToolResult.content` shape
 * (`TextContent | ImageContent`). Anything unrecognized is serialized as
 * text so the model still sees a result.
 */
function mcpContentToPi(
  content: ContentBlock[] | undefined,
): Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> {
  const out: Array<{
    type: "text";
    text: string;
  } | { type: "image"; data: string; mimeType: string }> = [];
  if (!Array.isArray(content)) return out;
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      out.push({ type: "text", text: block.text });
    } else if (block.type === "image" && typeof block.data === "string") {
      const mimeType =
        typeof block.mimeType === "string" ? block.mimeType : "image/png";
      out.push({ type: "image", data: block.data, mimeType });
    } else if (block.type === "resource") {
      const resource = (block as {
        resource?: { text?: unknown; blob?: unknown; mimeType?: unknown; uri?: unknown };
      }).resource;
      if (resource && typeof resource.text === "string") {
        out.push({ type: "text", text: resource.text });
      } else if (resource && typeof resource.blob === "string") {
        const mimeType =
          typeof resource.mimeType === "string" ? resource.mimeType : "";
        if (mimeType.startsWith("image/")) {
          out.push({ type: "image", data: resource.blob, mimeType });
        } else {
          out.push({
            type: "text",
            text: `[${mimeType || "binary resource"} ${resource.uri || ""}]`,
          });
        }
      } else {
        out.push({ type: "text", text: JSON.stringify(block) });
      }
    } else {
      out.push({ type: "text", text: JSON.stringify(block) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// tool wrapping
// ---------------------------------------------------------------------------

/** Prefix + sanitize so MCP tool names are unique and LLM-safe. */
function mcpToolFullName(serverName: string, toolName: string): string {
  const sanitize = (name: string): string => {
    const cleaned = name.replace(/[^A-Za-z0-9_-]/g, "_");
    const prefixed = /^[A-Za-z_]/.test(cleaned) ? cleaned : `mcp_${cleaned}`;
    return prefixed.slice(0, MAX_TOOL_NAME_LENGTH) || "mcp_tool";
  };
  return `${sanitize(serverName)}__${sanitize(toolName)}`;
}

function toPiToolDefinition(
  client: Client,
  server: McpServer,
  mcpTool: McpTool,
): AnyPiTool {
  const name = mcpToolFullName(server.name, mcpTool.name);
  const parameters = jsonSchemaToTypeBox(mcpTool.inputSchema);
  const result: AnyPiTool = {
    name,
    label: mcpTool.name,
    description:
      mcpTool.description && mcpTool.description.trim().length > 0
        ? mcpTool.description
        : `Tool "${mcpTool.name}" from the "${server.name}" MCP server.`,
    promptSnippet: `${mcpTool.name} (MCP: ${server.name})`,
    parameters,
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ): Promise<AgentToolResult<unknown>> => {
      let callResult: CallToolResult;
      try {
        callResult = await client.callTool({
          name: mcpTool.name,
          arguments: (params ?? {}) as Record<string, unknown>,
        });
      } catch (err) {
        throw new Error(
          `MCP tool ${server.name}/${mcpTool.name} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      if (callResult.isError) {
        throw new Error(
          mcpContentToText(callResult.content) ||
            `MCP tool ${server.name}/${mcpTool.name} returned an error.`,
        );
      }
      return {
        content: mcpContentToPi(callResult.content),
        details: {
          mcpServer: server.name,
          mcpTool: mcpTool.name,
          structuredContent: callResult.structuredContent ?? undefined,
        },
      };
    },
  };
  return result;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export interface McpToolDefinitions {
  /** Wrapped Pi tool definitions (one per MCP tool of the connected servers). */
  tools: AnyPiTool[];
  /** Close every client connection (stdio child processes included). */
  close: () => Promise<void>;
}

/**
 * Connect every configured server and wrap its tools for Pi.
 *
 * A failing server is skipped (logged) so one misconfigured MCP server cannot
 * break the whole agent session.
 */
export async function createMcpToolDefinitions(
  servers: McpServer[],
): Promise<McpToolDefinitions> {
  const clients: Client[] = [];
  const tools: AnyPiTool[] = [];
  for (const server of servers) {
    try {
      const client = new Client({
        name: `imboss-mcp-${server.name}`,
        version: "0.1.0",
      });
      const transport = buildMcpTransport(server.config);
      await connectWithTimeout(client, transport);
      clients.push(client);
      const listed = await client.listTools();
      for (const mcpTool of listed.tools) {
        tools.push(toPiToolDefinition(client, server, mcpTool));
      }
    } catch (err) {
      console.error(
        `[mcp] Failed to connect "${server.name}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return {
    tools,
    close: async (): Promise<void> => {
      await Promise.all(
        clients.map((client) => client.close().catch(() => undefined)),
      );
    },
  };
}
