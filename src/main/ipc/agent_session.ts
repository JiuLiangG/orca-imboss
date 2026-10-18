import { ipcMain } from "electron";
import {
  bind,
  interruptChat,
  interruptTurn,
  unbind,
} from "../agent/session-queue";
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

  // Halt: interrupt every agent session belonging to a chat — its non-assistant
  // employee participants plus the assistant's root-chat orchestration session.
  // Returns the number of session states acted on.
  ipcMain.handle(
    "agentSession:interruptChat",
    (_event, chatId: unknown): Promise<number> =>
      interruptChat(assertInteger(chatId, "chat id")),
  );

  // Interrupt the **current turn** of exactly one `(employee, chat)` session
  // (the agent-session view's button). Queued messages are kept and the session
  // stays alive. Returns whether a streaming run was actually interrupted.
  ipcMain.handle(
    "agentSession:interruptTurn",
    (_event, employeeId: unknown, chatId: unknown): Promise<boolean> =>
      interruptTurn(
        assertInteger(employeeId, "employee id"),
        assertInteger(chatId, "chat id"),
      ),
  );
}
