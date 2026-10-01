import { READ_CHAT_PROMPT } from "@shared/constants/prompts";
import { ipcMain, shell } from "electron";
import { existsSync } from "fs";
import { isAbsolute } from "path";
import { wakeAgent } from "../agent/session-queue";
import * as dbMessages from "../db/messages";
import { assertInteger, assertObject, assertString } from "./helpers";

export function registerMessageHandlers(): void {
  ipcMain.handle("messages:list", (_event, chatId: unknown) =>
    dbMessages.listMessages(assertInteger(chatId, "chat id")),
  );

  ipcMain.handle("messages:search", (_event, query: unknown) =>
    dbMessages.searchMessages(assertString(query, "query")),
  );

  ipcMain.handle(
    "messages:append",
    (_event, chatId: unknown, senderEmployeeId: unknown, content: unknown) => {
      const safeChatId = assertInteger(chatId, "chat id");
      const safeSender =
        senderEmployeeId === null
          ? null
          : assertInteger(senderEmployeeId, "sender id");
      return dbMessages.appendMessage(
        safeChatId,
        safeSender,
        assertString(content, "content"),
      );
    },
  );

  // Human (or any renderer) answers an ask message: append a kind=`answer`
  // system message and wake the ask's sender agent so it can react.
  ipcMain.handle(
    "messages:answer",
    (_event, chatId: unknown, askMessageId: unknown, answers: unknown) => {
      const safeChatId = assertInteger(chatId, "chat id");
      const safeAskId = assertInteger(askMessageId, "ask message id");
      const safeAnswers = JSON.stringify(assertObject(answers, "answers"));
      const message = dbMessages.appendMessage(safeChatId, null, safeAnswers, {
        kind: "answer",
      });
      const ask = dbMessages.getMessageById(safeAskId);
      if (ask && ask.senderEmployeeId != null) {
        // `wakeAgent` redirects the assistant (id 0) from a task group chat to
        // its root-chat session.
        void wakeAgent(ask.senderEmployeeId, safeChatId, READ_CHAT_PROMPT);
      }
      return message;
    },
  );

  // Reveal a message attachment in the OS file manager. The renderer only
  // passes the message id + index; the path is read from the trusted stored
  // record so a compromised renderer can never reveal arbitrary paths.
  ipcMain.handle(
    "messages:revealAttachment",
    (_event, messageId: unknown, index: unknown) => {
      const safeId = assertInteger(messageId, "message id");
      const safeIndex = assertInteger(index, "attachment index");
      if (safeIndex < 0) {
        throw new Error("Attachment index must be non-negative.");
      }
      const message = dbMessages.getMessageById(safeId);
      if (!message) throw new Error("Message does not exist.");
      const attachments = message.attachments;
      if (!attachments || safeIndex >= attachments.length) {
        throw new Error("Attachment does not exist.");
      }
      const path = attachments[safeIndex].path;
      if (!path) throw new Error("Attachment location is unavailable.");
      if (!isAbsolute(path)) {
        throw new Error("Attachment location is invalid.");
      }
      if (!existsSync(path)) {
        throw new Error("Attachment file no longer exists.");
      }
      shell.showItemInFolder(path);
    },
  );
}
