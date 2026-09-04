import { app } from "electron";
import electronUpdater from "electron-updater";

// electron-updater is a CommonJS module; use the default-import interop to
// reliably obtain the singleton `autoUpdater`. See electron-builder docs.
const { autoUpdater } = electronUpdater;

/**
 * Wire automatic updates against the GitHub provider configured in
 * `electron-builder.yml`. Only runs in the packaged app (never in dev).
 */
export function initUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.logger = console;

  autoUpdater.on("checking-for-update", () => {
    // TODO: notify renderer via IPC for UI feedback.
  });
  autoUpdater.on("update-available", () => {
    autoUpdater.downloadUpdate();
  });
  autoUpdater.on("update-not-available", () => {
    // no-op
  });
  autoUpdater.on("download-progress", () => {
    // TODO: forward progress to renderer via IPC.
  });
  autoUpdater.on("update-downloaded", () => {
    autoUpdater.quitAndInstall();
  });
  autoUpdater.on("error", (error) => {
    console.error("[updater]", error);
  });

  autoUpdater.checkForUpdates().catch((error) => {
    console.error("[updater] checkForUpdates failed", error);
  });
}
