import type {
  McpServerConfig,
  McpServerEntry,
} from "@earendil-works/pi-coding-agent";
import type { McpConfig, McpServer } from "@shared/types";
import { getMcpConfigPath, parseMcpArgs } from "../mcp-store";
import { mergeEnv } from "./user-env";

/**
 * Map the app's `mcp.json`-backed server configs into the Pi SDK MCP
 * extension's server entries.
 *
 * The SDK's MCP extension connects *every* server its `loadConfig` returns, so
 * per-employee visibility is achieved by giving each session only the servers
 * its employee selected (the caller filters before calling here).
 *
 * Design (confirmed):
 * - **Exposure `direct`**: MCP tools are declared to the model, matching the
 *   app's previous behaviour. (The SDK default is `codemode`.)
 * - **stdio env**: the SDK transport spawns with
 *   `{ ...process.env, ...config.env }`; `config.env` therefore carries the
 *   user env merged under the per-server env (per-server wins). Process env is
 *   inherited by the transport, so it is not repeated here.
 * - **HTTP** (`streamable-http`): URL + headers are passed verbatim.
 * - `source` points at the app's `mcp.json` for accurate diagnostics.
 */
export function toMcpServerEntries(
  servers: McpServer[],
  userEnv: Record<string, string>,
): McpServerEntry[] {
  const source = getMcpConfigPath();
  return servers.map((server) => ({
    name: server.name,
    config: toSdkConfig(server.config, server.description, userEnv),
    source,
    scope: "global",
  }));
}

function toSdkConfig(
  config: McpConfig,
  description: string,
  userEnv: Record<string, string>,
): McpServerConfig {
  const trimmed = description.trim();
  const base = {
    exposure: "direct" as const,
    ...(trimmed.length > 0 ? { description: trimmed } : {}),
  };
  if (config.transport === "stdio") {
    return {
      ...base,
      type: "stdio",
      command: config.command,
      args: parseMcpArgs(config.args),
      env: mergeEnv(userEnv, config.env),
    };
  }
  return {
    ...base,
    type: "http",
    url: config.url,
    headers: { ...config.headers },
  };
}
