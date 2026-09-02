import { app, BrowserWindow, shell } from "electron";
import { join } from "path";
import icon from "../../resources/icon.png?asset";
import { deleteAvatarFiles } from "./avatars";
import { initDatabase } from "./db";
import { purgeDisabledEmployees } from "./db/services/employees";
import { unlinkSessionFile } from "./db/services/sessions";
import { refreshModelStore } from "./agent/model-runtime";
import * as cron from "./cron";
import { registerIpcHandlers, setupNativeTheme } from "./ipc";
import { getResolvedLocale } from "./locale";
import { setMainWindow } from "./notifications";
import { initUpdater } from "./updater";
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  loadWindowBounds,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  saveWindowBounds,
} from "./window-state";

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Best-effort stop of in-process cron handles before the app quits.
app.on("before-quit", () => {
  cron.stopAll();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function createWindow(): void {
  const locale = getResolvedLocale();
  // Restore the last session's position+size; fall back to centered defaults when
  // the saved bounds are invalid (missing, below minimum, or outside every display).
  const savedBounds = loadWindowBounds();

  const mainWindow = new BrowserWindow({
    ...(savedBounds ?? {
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    }),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    // macOS: nudge the native traffic lights into the collapsed sidebar column.
    // ...(isMac ? { trafficLightPosition: { x: 8, y: 9 } } : {}),
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      spellcheck: false,
      additionalArguments: [`--locale=${locale}`],
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  // Forward maximize state to the renderer (drives the custom window buttons).
  mainWindow.on("maximize", () =>
    mainWindow.webContents.send("window:maximized", true),
  );
  mainWindow.on("unmaximize", () =>
    mainWindow.webContents.send("window:maximized", false),
  );

  // Persist the window's position and size (its normal, unmaximized bounds) so
  // they can be restored on the next launch.
  mainWindow.on("close", () => saveWindowBounds(mainWindow));

  // Register the window for OS notification click-to-focus + jump-to-chat.
  setMainWindow(mainWindow);
  mainWindow.on("closed", () => setMainWindow(null));

  // Open external links in the OS browser; never allow in-app popups.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  // Matches `appId` in electron-builder.yml.
  app.setAppUserModelId("com.orcastudio.imboss");

  initDatabase();
  registerIpcHandlers();
  setupNativeTheme();

  // Re-register persisted cron jobs (fire-and-forget; only while app is alive).
  cron.initCron();

  createWindow();

  // Best-effort cleanup of disabled employees no longer in any chat. Fire-and-
  // forget: a failure is logged and never blocks startup.
  void purgeDisabledEmployeesOnStartup();

  // Warm the app's model store over the network so configured provider/model
  // catalogs are fresh for the whole session. Fire-and-forget (non-blocking):
  // startup stays responsive and a failed refresh is only logged, never shown.
  void refreshModelStore(new AbortController().signal);

  if (app.isPackaged) initUpdater();
});

/**
 * Hard-delete employees that were disabled and are no longer a chat participant,
 * then unlink their session and avatar files. Try/catch every step so the
 * app still launches when the data folder is in a weird state.
 */
async function purgeDisabledEmployeesOnStartup(): Promise<void> {
  try {
    const purged = purgeDisabledEmployees();
    for (const entry of purged) {
      await Promise.all(
        entry.sessionPaths.map((path) => unlinkSessionFile(path)),
      );
      deleteAvatarFiles(entry.employeeId);
    }
  } catch (err) {
    console.error(
      "[startup] purge disabled employees failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
