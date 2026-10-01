import type { McpServerInput } from "@shared/types";
import { ipcMain } from "electron";
import * as mcpStore from "../mcp-store";
import { assertString } from "./helpers";

/**
 * MCP server CRUD over the app's `~/.imboss/agent/mcp.json`. Servers are keyed
 * by name (the `mcp.json` key), so update/delete take the current name.
 */
export function registerMcpHandlers(): void {
  ipcMain.handle("mcp:list", () => mcpStore.readMcpServers());

  ipcMain.handle("mcp:create", (_event, input: McpServerInput) =>
    mcpStore.createMcpServer(input),
  );

  ipcMain.handle("mcp:update", (_event, name: unknown, input: McpServerInput) =>
    mcpStore.updateMcpServer(assertString(name, "mcp name"), input),
  );

  ipcMain.handle("mcp:delete", (_event, name: unknown) =>
    mcpStore.deleteMcpServer(assertString(name, "mcp name")),
  );
}
