import { ipcMain } from "electron";
import { bind, unbind } from "../agent/session-queue";
import { assertInteger } from "./helpers";

/**
 * Renderer ↔ main binding for live agent sessions.
 *
 * `agentSession:bind` registers `event.sender` to receive the `(employee,
 * chat)` session's streamed events over `agentSession:event`. The session
 * itself is created lazily on the first `deliver(...)` (chat send / cron), so
 * binding a chat does not build a Pi session. `agentSession:unbind` removes the
 * registration.
 */
export function registerAgentSessionHandlers(): void {
  ipcMain.handle(
    "agentSession:bind",
    (event, employeeId: unknown, chatId: unknown): void => {
      bind(
        assertInteger(employeeId, "employee id"),
        assertInteger(chatId, "chat id"),
        event.sender,
      );
    },
  );

  ipcMain.handle(
    "agentSession:unbind",
    (event, employeeId: unknown, chatId: unknown): void => {
      unbind(
        assertInteger(employeeId, "employee id"),
        assertInteger(chatId, "chat id"),
        event.sender,
      );
    },
  );
}
