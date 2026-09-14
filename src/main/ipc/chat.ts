import { ASSISTANT_ID } from "@shared/constants/employees";
import type { ChatParticipantUpdate, MessageAttachment } from "@shared/types";
import { ipcMain } from "electron";
import { deliver } from "../agent/session-queue";
import * as dbChats from "../db/chats";
import * as dbMessages from "../db/messages";
import { listByChat, unlinkSessionFile } from "../db/sessions";
import { broadcast, notifyUnread } from "../notifications";
import { assertInteger, assertString, parsePageQuery } from "./helpers";

export function registerChatHandlers(): void {
  ipcMain.handle("chats:list", () => dbChats.listChats());

  ipcMain.handle("chats:summaries", () => dbChats.listChatSummaries());

  ipcMain.handle("chats:summariesPage", (_event, page: unknown) =>
    dbChats.listChatSummariesPage(parsePageQuery(page)),
  );

  // Single chat summary (live per-chat refresh by the renderer).
  ipcMain.handle("chats:summary", (_event, id: unknown) =>
    dbChats.getChatSummary(assertInteger(id, "chat id")),
  );

  // Renderer-initiated unread delta (delegates to notifyUnread).
  ipcMain.handle(
    "chats:addUnread",
    (_event, id: unknown, delta: unknown): number => {
      const safeId = assertInteger(id, "chat id");
      const safeDelta = assertInteger(delta, "unread delta");
      return notifyUnread(safeId, safeDelta, "");
    },
  );

  ipcMain.handle("chats:markRead", (_event, id: unknown) => {
    const safeId = assertInteger(id, "chat id");
    dbChats.markRead(safeId);
    // Keep the renderer unread mirror in sync (cleared on open).
    broadcast("chats:unreadChanged", { chatId: safeId, unread: 0 });
  });

  ipcMain.handle(
    "chats:create",
    (_event, title: unknown, participants: unknown[]) => {
      if (!Array.isArray(participants)) {
        throw new Error("participants must be an array.");
      }
      return dbChats.createChat(
        assertString(title, "title"),
        participants.map((p) => assertInteger(p, "participant id")),
      );
    },
  );

  ipcMain.handle("chats:update", (_event, id: unknown, title: unknown) => {
    const safeId = assertInteger(id, "chat id");
    return dbChats.updateChatTitle(safeId, assertString(title, "title"));
  });

  ipcMain.handle(
    "chats:updateParticipants",
    (_event, id: unknown, changes: ChatParticipantUpdate) => {
      const safeId = assertInteger(id, "chat id");
      return dbChats.updateChatParticipants(safeId, changes);
    },
  );

  ipcMain.handle("chats:delete", async (_event, id: unknown) => {
    const safeId = assertInteger(id, "chat id");
    const records = listByChat(safeId);
    const removed = dbChats.deleteChat(safeId);
    if (removed) {
      await Promise.all(records.map((r) => unlinkSessionFile(r.session)));
    }
    return removed;
  });

  /**
   * Chat pipeline: append the user message → run the assistant's agent turn
   * (serialized per session queue).
   */
  ipcMain.handle(
    "chat:send",
    async (_event, chatId: unknown, content: unknown, attachments: unknown) => {
      const safeChatId = assertInteger(chatId, "chat id");
      const safeContent = assertString(content, "content");
      const safeAttachments = validateAttachmentsPayload(attachments);

      const userMessage = dbMessages.appendMessage(
        safeChatId,
        null,
        safeContent.length > 0 ? safeContent : "[附件]",
        safeAttachments ? { attachments: safeAttachments } : {},
      );

      // Serialized run; the reply is auto-persisted as the assistant message.
      void deliver(ASSISTANT_ID, safeChatId, safeContent, {
        persistReplyAs: ASSISTANT_ID,
      });

      return userMessage;
    },
  );
}

function validateAttachmentsPayload(
  value: unknown,
): MessageAttachment[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error("attachments must be an array.");
  // Field-level validation happens in the messages service; pass through and
  // let it throw on malformed entries.
  return value as MessageAttachment[];
}
