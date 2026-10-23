import type { ShortcutRejectReason } from "../shortcut";

/**
 * State of the global "show / hide main window" shortcut.
 *
 * `accelerator` is the value the app is currently *trying* to use (`null` = the
 * feature is turned off). `registered` says whether the OS actually holds it
 * right now — they differ while the shortcut is suspended for recording, and
 * when the OS refused the registration.
 */
export interface WindowShortcutState {
  accelerator: string | null;
  /** Built-in default of the current platform (what "reset" restores). */
  defaultAccelerator: string;
  registered: boolean;
  /** Why the last registration attempt failed (`null` when it succeeded). */
  error: ShortcutRejectReason | null;
}

/** Result of a `window:setShortcut` call. */
export interface WindowShortcutUpdate {
  /** `false` → nothing was persisted and the previous shortcut is still active. */
  accepted: boolean;
  rejected: ShortcutRejectReason | null;
  state: WindowShortcutState;
}
