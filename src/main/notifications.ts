import { BrowserWindow, Notification } from "electron";
import * as dbChats from "./db/chats";
import { getMainWindow, showMainWindow } from "./main-window";

/**
 * Send a payload to the main window (no-op before creation / after destruction).
 * `payload` is optional for channels that only signal "something changed"
 * (e.g. `skills:changed`), whose listeners take no argument.
 */
export function sendToRenderer(channel: string, payload?: unknown): void {
  const win = getMainWindow();
  if (win) win.webContents.send(channel, payload);
}

/**
 * Bump a chat's unread counter by `delta` (clamped >= 0), mirror the new count
 * to the renderer, and — when the app window is not focused — show an OS
 * notification that, when clicked, focuses the app and jumps to the chat.
 *
 * Root chats only: task group chats (fromChatId !== null) never record unread
 * (the badge is root-chat only and group chats track reads via read_cursors),
 * so a group chat id is rejected rather than silently ignored.
 *
 * A muted chat keeps counting unread (the badge stays honest) but raises no OS
 * notification.
 *
 * Returns the new unread count.
 */
export function notifyUnread(
  chatId: number,
  delta: number,
  text: string,
): number {
  const chat = dbChats.getChat(chatId);
  if (!chat) return 0;
  if (chat.fromChatId !== null) return 0;

  const newUnread = dbChats.addUnread(chatId, delta);
  sendToRenderer("chats:unreadChanged", { chatId, unread: newUnread });

  // A muted conversation still counts unread, but never notifies.
  if (chat.muted) return newUnread;

  const target = getMainWindow();
  const focused = BrowserWindow.getFocusedWindow();
  // Only send an OS notification when the app is genuinely in the foreground.
  if (target && focused && focused === target) return newUnread;

  if (target && Notification.isSupported()) {
    const notification = new Notification({
      title: chatTitle(chatId),
      body: text,
    });
    notification.on("click", () => {
      // The window may be hidden (or minimized) when the notification is
      // clicked: `showMainWindow()` covers every state, plain `show()` does not.
      showMainWindow();
      getMainWindow()?.webContents.send("chat:focus", chatId);
    });
    notification.show();
  }
  return newUnread;
}

/** Notification title — the chat title when resolvable, otherwise the app name. */
function chatTitle(chatId: number): string {
  const chat = dbChats.getChat(chatId);
  const name = chat?.title?.trim();
  return name && name.length > 0 ? name : "Imboss";
}
