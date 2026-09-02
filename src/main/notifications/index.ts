import { BrowserWindow, Notification } from "electron";
import * as chatsService from "../db/services/chats";

let mainWindow: BrowserWindow | null = null;

/**
 * Register the main window so notification click handlers can focus + jump to
 * a chat. Called from `createWindow()`.
 */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

/** Send a payload to every live renderer window. */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * Bump a chat's unread counter by `delta` (clamped >= 0), mirror the new count
 * to the renderer, and — when the app window is not focused — show an OS
 * notification that, when clicked, focuses the app and jumps to the chat.
 *
 * Returns the new unread count.
 */
export function notifyUnread(
  chatId: number,
  delta: number,
  text: string,
): number {
  const newUnread = chatsService.addUnread(chatId, delta);
  broadcast("chats:unreadChanged", { chatId, unread: newUnread });

  const target = resolveTargetWindow();
  const focused = BrowserWindow.getFocusedWindow();
  // Only send an OS notification when the app is genuinely in the background.
  if (target && focused && focused === target) return newUnread;

  if (target && Notification.isSupported()) {
    const notification = new Notification({
      title: chatTitle(chatId),
      body: text,
    });
    notification.on("click", () => {
      if (target.isDestroyed()) return;
      target.show();
      target.focus();
      target.webContents.send("chat:focus", chatId);
    });
    notification.show();
  }
  return newUnread;
}

/** Resolve the main window (fall back to the first live window). */
function resolveTargetWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return BrowserWindow.getAllWindows()[0] ?? null;
}

/** Notification title — the chat title when resolvable, otherwise the app name. */
function chatTitle(chatId: number): string {
  const chat = chatsService.getChat(chatId);
  const name = chat?.title?.trim();
  return name && name.length > 0 ? name : "Imboss";
}

/** Show an OS-level notification (kept for any other caller). */
export function showNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}
