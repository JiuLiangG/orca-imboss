import { BrowserWindow, ipcMain } from "electron";
import {
  getWindowShortcutState,
  setWindowShortcut,
  suspendWindowShortcut,
} from "../window-shortcut";

export function registerWindowHandlers(): void {
  const winOf = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender);

  ipcMain.handle("window:minimize", (event) => {
    winOf(event)?.minimize();
  });

  ipcMain.handle("window:toggleMaximize", (event) => {
    const win = winOf(event);
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  // "Close" hides the window (see `main-window.ts`); it never quits the app.
  ipcMain.handle("window:close", (event) => {
    winOf(event)?.close();
  });

  ipcMain.handle("window:isMaximized", (event) => {
    return winOf(event)?.isMaximized() ?? false;
  });

  // Global show/hide shortcut. A dedicated channel (not `settings:set`) because
  // the value has to be registered with the OS in the same transaction — see
  // `window-shortcut.ts`.
  ipcMain.handle("window:getShortcut", () => getWindowShortcutState());

  ipcMain.handle("window:setShortcut", (_event, accelerator: unknown) =>
    setWindowShortcut(accelerator),
  );

  ipcMain.handle("window:suspendShortcut", (_event, suspended: unknown) => {
    if (typeof suspended !== "boolean") {
      throw new Error("suspended must be a boolean.");
    }
    return suspendWindowShortcut(suspended);
  });
}
