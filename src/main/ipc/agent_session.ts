import { ASSISTANT_ID } from "@shared/constants/employees";
import type {
  AgentSessionRunState,
  AgentSessionSendResult,
} from "@shared/types";
import { ipcMain } from "electron";
import {
  bind,
  deliver,
  interruptChat,
  interruptTurn,
  readRunState,
  unbind,
} from "../agent/session-queue";
import { getChat, getRootChatId } from "../db/chats";
import { getEmployee } from "../db/employees";
import { assertInteger, assertString } from "./helpers";

/**
 * Mirrors the `messages.content` limit. A session prompt is not stored there,
 * but one bound keeps an unbounded string from ever reaching the model.
 */
const MAX_MESSAGE_LENGTH = 100_000;

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

  // Cosmetic run state for the same view: labels (`Send` vs `Interject`) and the
  // interrupt chip's enabled state. Never used to route a message — `deliver()`
  // re-checks the live session.
  ipcMain.handle(
    "agentSession:state",
    (_event, employeeId: unknown, chatId: unknown): AgentSessionRunState =>
      readRunState(
        assertInteger(employeeId, "employee id"),
        assertInteger(chatId, "chat id"),
      ),
  );

  /**
   * Send a message into exactly one `(employee, chat)` agent session — the
   * agent-session view's composer.
   *
   * The text is injected into that employee's Pi session **only**: nothing is
   * written to the conversation and no `read_cursors` row moves, so the chat
   * transcript stays untouched (boss's explicit decision). `deliver()` decides
   * between steering the live run and queueing, and never throws for a run
   * failure (those surface as `error` events on the bound windows), so a
   * rejection here only ever means the request itself was invalid.
   */
  ipcMain.handle(
    "agentSession:send",
    async (
      _event,
      employeeId: unknown,
      chatId: unknown,
      text: unknown,
    ): Promise<AgentSessionSendResult> => {
      const safeEmployee = assertInteger(employeeId, "employee id");
      const safeChat = assertInteger(chatId, "chat id");
      const safeText = assertString(text, "message");
      if (safeText.trim().length === 0) {
        throw new Error("Message must not be empty.");
      }
      if (safeText.length > MAX_MESSAGE_LENGTH) {
        throw new Error("Message is too long.");
      }

      // Defensive guards: never materialize a session for a pair that cannot
      // legitimately own one (deleted employee/chat, a removed participant) —
      // `deliver()` would happily create one. The assistant is exempt from the
      // participant check: its session lives in the chat's root chat, which it
      // always belongs to, and a legacy root chat may lack the row.
      if (!getEmployee(safeEmployee)) {
        throw new Error("Employee not found.");
      }
      const chat = getChat(safeChat);
      if (!chat) {
        throw new Error("Conversation not found.");
      }
      if (
        safeEmployee !== ASSISTANT_ID &&
        !chat.participants.includes(safeEmployee)
      ) {
        throw new Error(
          "The employee is not a participant of this conversation.",
        );
      }
      // The assistant has no session in a task group chat (it runs in the root
      // chat); `openAgentSession` always resolves this, so a mismatch is a bug.
      if (
        safeEmployee === ASSISTANT_ID &&
        getRootChatId(safeChat) !== safeChat
      ) {
        throw new Error(
          "The assistant's session only exists in its root chat.",
        );
      }

      return {
        mode: await deliver(safeEmployee, safeChat, safeText, {
          mode: "steer",
        }),
      };
    },
  );
}
