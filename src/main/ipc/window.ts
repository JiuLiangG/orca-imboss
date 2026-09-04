import { BrowserWindow, ipcMain } from "electron";

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

  ipcMain.handle("window:close", (event) => {
    winOf(event)?.close();
  });

  ipcMain.handle("window:isMaximized", (event) => {
    return winOf(event)?.isMaximized() ?? false;
  });
}
