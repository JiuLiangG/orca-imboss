import { Notification } from "electron";

/**
 * Show an OS-level notification.
 *
 * TODO(notifications): The trigger rules are not finalized yet. Once defined,
 * this module will be invoked from the agent/event layer when the app is in
 * the background (e.g. new assistant message, task completion).
 */
export function showNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}
