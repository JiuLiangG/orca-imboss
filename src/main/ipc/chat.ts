import { ASSISTANT_ID } from "@shared/constants/employees";
import type { ChatParticipantUpdate, MessageAttachment } from "@shared/types";
import { ipcMain } from "electron";
import { deliver, disposeForChat } from "../agent/session-queue";
import { maybeGenerateChatTitle } from "../agent/title-gen";
import * as dbChats from "../db/chats";
import * as dbMessages from "../db/messages";
import { listByChat, unlinkSessionFile } from "../db/sessions";
import { notifyUnread, sendToRenderer } from "../notifications";
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
    sendToRenderer("chats:unreadChanged", { chatId: safeId, unread: 0 });
  });

  ipcMain.handle(
    "chats:create",
    (_event, title: unknown, participants: unknown[]) => {
      if (!Array.isArray(participants)) {
        throw new Error("participants must be an array.");
      }
      const ids = participants.map((p) => assertInteger(p, "participant id"));
      // The assistant is always a participant of a root (assistant ↔ user)
      // chat so it can post replies with `imb_send_message`.
      const withAssistant = [...new Set([ASSISTANT_ID, ...ids])];
      return dbChats.createChat(assertString(title, "title"), withAssistant);
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
    // Chats spawned from this one (`from_chat_id`) go with it, and those may
    // spawn further chats, so delete the whole descendant tree.
    const chatIds = dbChats.listChatTreeIds(safeId);
    if (chatIds.length === 0) return false;
    // Capture disk session file paths BEFORE the FK cascade wipes the rows.
    const records = chatIds.flatMap((chatId) => listByChat(chatId));
    // Tear down any warm agent sessions for these chats before files go away.
    await Promise.all(chatIds.map((chatId) => disposeForChat(chatId)));
    const removed = dbChats.deleteChats(chatIds) > 0;
    if (removed) {
      await Promise.all(records.map((r) => unlinkSessionFile(r.session)));
      // Keep every window in sync: chat caches + opened group-chat entries.
      sendToRenderer("chats:deleted", { chatIds });
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
        !!safeAttachments?.length ? { attachments: safeAttachments } : {},
      );

      // Immediate, app-generated receipt so the user sees an acknowledgement
      // before the (slow) agent turn produces anything. Defensive: a failure
      // here must never break the send — the user message is already stored.
      try {
        dbMessages.appendMessage(safeChatId, ASSISTANT_ID, "", {
          kind: "ack",
          silent: true,
        });
      } catch (err) {
        console.error(
          "[chat:send] failed to append receipt ack:",
          err instanceof Error ? err.message : err,
        );
      }

      // Serialized run; the agent posts its own reply via `imb_send_message`.
      void deliver(ASSISTANT_ID, safeChatId, safeContent);

      // First message of an untitled chat → generate a title from it
      // (fire-and-forget; retries on the next message when it fails).
      maybeGenerateChatTitle(safeChatId, safeContent);

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
