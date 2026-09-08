import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { MCP_TRANSPORTS } from "@shared/constants/mcp";

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

/** Shared Pi tool definition type (any params/details — variance-safe). */
export type AnyPiTool = ToolDefinition<any, any, any>;

export interface McpToolDefinitions {
  /** Wrapped Pi tool definitions (one per MCP tool of the connected servers). */
  tools: AnyPiTool[];
  /** Close every client connection (stdio child processes included). */
  close: () => Promise<void>;
}
