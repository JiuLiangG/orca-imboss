import type { McpServerInput } from "@shared/types";
import { ipcMain } from "electron";
import * as mcpService from "../db/mcp";
import { assertInteger, parsePageQuery } from "./helpers";

export function registerMcpHandlers(): void {
  ipcMain.handle("mcp:list", () => mcpService.listMcpServers());

  ipcMain.handle("mcp:listPage", (_event, page: unknown) =>
    mcpService.listMcpServersPage(parsePageQuery(page)),
  );

  ipcMain.handle("mcp:get", (_event, id: unknown) =>
    mcpService.getMcpServer(assertInteger(id, "mcp id")),
  );

  ipcMain.handle("mcp:create", (_event, input: McpServerInput) =>
    mcpService.createMcpServer(input),
  );

  ipcMain.handle("mcp:update", (_event, id: unknown, input: McpServerInput) =>
    mcpService.updateMcpServer(assertInteger(id, "mcp id"), input),
  );

  ipcMain.handle("mcp:delete", (_event, id: unknown) =>
    mcpService.deleteMcpServer(assertInteger(id, "mcp id")),
  );
}
