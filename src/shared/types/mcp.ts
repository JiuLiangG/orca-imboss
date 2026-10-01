import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { MCP_TRANSPORTS } from "@shared/constants/mcp";

export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/**
 * Transport-specific configuration payload. `stdio` spawns a command,
 * `http` talks to a streamable-HTTP URL endpoint.
 *
 * This is the app's internal shape used by the UI and IPC layer. It is
 * converted to/from the SDK's `mcp.json` entry shape by `src/main/mcp-store.ts`
 * (file storage) and `src/main/agent/mcp.ts` (SDK server entries).
 */
export type McpConfig =
  | {
      transport: "stdio";
      command: string;
      args: string;
      env: Record<string, string>;
    }
  | { transport: "http"; url: string; headers: Record<string, string> };

/**
 * One MCP server (`mcp.json` is keyed by name, so `name` is the identity).
 * `description` is stored as the entry's `description` field.
 */
export interface McpServer {
  name: string;
  description: string;
  config: McpConfig;
}

/** Full-replacement input for MCP server create/update. */
export interface McpServerInput {
  name: string;
  description: string;
  config: McpConfig;
}

/** Shared Pi tool definition type (any params/details — variance-safe). */
export type AnyPiTool = ToolDefinition<any, any, any>;
