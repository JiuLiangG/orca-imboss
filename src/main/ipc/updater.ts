import { ipcMain } from "electron";
import {
  cancelUpdateDownload,
  checkForUpdates,
  downloadUpdate,
  getUpdaterState,
  installUpdate,
} from "../updater";

/**
 * Updater IPC. The renderer only *requests* actions; all state and
 * electron-updater interaction stays in `src/main/updater.ts`. Handlers take no
 * arguments, so there is no untrusted input to validate here.
 */
export function registerUpdaterHandlers(): void {
  ipcMain.handle("updater:getState", () => getUpdaterState());

  ipcMain.handle("updater:check", () => checkForUpdates(false));

  ipcMain.handle("updater:download", () => downloadUpdate());

  ipcMain.handle("updater:cancel", () => {
    cancelUpdateDownload();
  });

  ipcMain.handle("updater:install", () => {
    installUpdate();
  });
}
