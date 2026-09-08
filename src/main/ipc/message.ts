import { READ_CHAT_PROMPT } from "@shared/constants/prompts";
import { ipcMain } from "electron";
import { deliver } from "../agent/session-queue";
import * as messagesService from "../db/messages";
import { assertInteger, assertObject, assertString } from "./helpers";

export function registerMessageHandlers(): void {
  ipcMain.handle("messages:list", (_event, chatId: unknown) =>
    messagesService.listMessages(assertInteger(chatId, "chat id")),
  );

  ipcMain.handle("messages:search", (_event, query: unknown) =>
    messagesService.searchMessages(assertString(query, "query")),
  );

  ipcMain.handle(
    "messages:append",
    (_event, chatId: unknown, senderEmployeeId: unknown, content: unknown) => {
      const safeChatId = assertInteger(chatId, "chat id");
      const safeSender =
        senderEmployeeId === null
          ? null
          : assertInteger(senderEmployeeId, "sender id");
      return messagesService.appendMessage(
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
      const message = messagesService.appendMessage(
        safeChatId,
        null,
        safeAnswers,
        { kind: "answer" },
      );
      const ask = messagesService.getMessageById(safeAskId);
      if (ask && ask.senderEmployeeId != null) {
        void deliver(ask.senderEmployeeId, safeChatId, READ_CHAT_PROMPT);
      }
      return message;
    },
  );
}
