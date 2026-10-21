import type { CapabilityUnlinkResult, McpServerInput } from "@shared/types";
import { ipcMain } from "electron";
import {
  reconcileCapabilityRefs,
  remapEmployeeMcpRef,
} from "../capability-refs";
import { notifyEmployeesChanged } from "../employee-events";
import * as mcpStore from "../mcp-store";
import { assertString } from "./helpers";

/**
 * MCP server CRUD over the app's `~/.imboss/agent/mcp.json`. Servers are keyed
 * by name (the `mcp.json` key), so update/delete take the current name.
 *
 * `mcp.json` is only half of an MCP server's state: employees persist the
 * *names* they selected (`employees.mcp`), and nothing in SQLite can enforce
 * that those names still exist. So the mutation handlers here own the
 * reference side too:
 *
 * - **delete** → unlink the name from every employee and report which ones
 *   changed, so the renderer can say "unlinked from N employees";
 * - **rename** → move the reference to the new key (a rename is not a loss of
 *   the link), otherwise every employee pointing at the old name would become
 *   a ghost.
 *
 * Out-of-band edits of `mcp.json` (the assistant edits the file directly, per
 * its `mcp-management` skill) are repaired by the read-path sweep instead —
 * see `capability-refs.ts`.
 */
export function registerMcpHandlers(): void {
  ipcMain.handle("mcp:list", () => mcpStore.readMcpServers());

  ipcMain.handle("mcp:create", (_event, input: McpServerInput) =>
    mcpStore.createMcpServer(input),
  );

  ipcMain.handle(
    "mcp:update",
    (_event, name: unknown, input: McpServerInput) => {
      const currentName = assertString(name, "mcp name");
      const updated = mcpStore.updateMcpServer(currentName, input);
      if (updated && updated.name !== currentName) {
        const remapped = remapEmployeeMcpRef(currentName, updated.name);
        notifyEmployeesChanged(remapped);
      }
      return updated;
    },
  );

  ipcMain.handle(
    "mcp:delete",
    (_event, name: unknown): CapabilityUnlinkResult => {
      const safeName = assertString(name, "mcp name");
      const removed = mcpStore.deleteMcpServer(safeName);
      if (!removed) return { removed: false, unlinkedEmployeeIds: [] };
      // Scoped sweep: only this name can have become dangling, so unrelated
      // references are not touched. `force` because a read-path sweep may have
      // run a moment ago and been throttled.
      const report = reconcileCapabilityRefs({
        mcp: [safeName],
        force: true,
      });
      notifyEmployeesChanged(report.employeeIds);
      return { removed: true, unlinkedEmployeeIds: report.employeeIds };
    },
  );
}
