import type { McpServerInput } from "@shared/types";
import { ipcMain } from "electron";
import * as dbMCP from "../db/mcp";
import { assertInteger, parsePageQuery } from "./helpers";

export function registerMcpHandlers(): void {
  ipcMain.handle("mcp:list", () => dbMCP.listMcpServers());

  ipcMain.handle("mcp:listPage", (_event, page: unknown) =>
    dbMCP.listMcpServersPage(parsePageQuery(page)),
  );

  ipcMain.handle("mcp:get", (_event, id: unknown) =>
    dbMCP.getMcpServer(assertInteger(id, "mcp id")),
  );

  ipcMain.handle("mcp:create", (_event, input: McpServerInput) =>
    dbMCP.createMcpServer(input),
  );

  ipcMain.handle("mcp:update", (_event, id: unknown, input: McpServerInput) =>
    dbMCP.updateMcpServer(assertInteger(id, "mcp id"), input),
  );

  ipcMain.handle("mcp:delete", (_event, id: unknown) =>
    dbMCP.deleteMcpServer(assertInteger(id, "mcp id")),
  );
}
