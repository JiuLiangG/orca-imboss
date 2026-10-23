import { BrowserWindow, dialog } from "electron";
import { beginNativeDialog, endNativeDialog } from "../main-window";

/**
 * Show a native open dialog attached to the focused window (falling back to the
 * first window). Returns the selected absolute paths, or `null` when the dialog
 * was cancelled or produced no selection.
 *
 * Sheet dialogs are tracked so the window cannot be hidden (close button /
 * global shortcut / tray) out from under an open dialog, which would leave a
 * floating ownerless sheet.
 */
export async function showOpenDialog(
  options: Electron.OpenDialogOptions,
): Promise<string[] | null> {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  beginNativeDialog();
  let result: Electron.OpenDialogReturnValue;
  try {
    result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
  } finally {
    endNativeDialog();
  }
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
}

/**
 * Show a native save dialog attached to the focused window (falling back to the
 * first window). Returns the chosen absolute path, or `null` when the dialog
 * was cancelled or produced no path.
 */
export async function showSaveDialog(
  options: Electron.SaveDialogOptions,
): Promise<string | null> {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  beginNativeDialog();
  let result: Electron.SaveDialogReturnValue;
  try {
    result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
  } finally {
    endNativeDialog();
  }
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}
