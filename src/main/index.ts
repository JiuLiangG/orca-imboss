import { app, BrowserWindow, shell } from "electron";
import { join } from "path";
import icon from "../../resources/icon.png?asset";
import { refreshModelStore } from "./agent/model-runtime";
import { disposeAll } from "./agent/session-queue";
import { deleteAvatarFiles } from "./avatars";
import * as cron from "./cron";
import { initDatabase } from "./db";
import { purgeDisabledEmployees } from "./db/employees";
import { unlinkSessionFile } from "./db/sessions";
import { registerIpcHandlers } from "./ipc";
import { getResolvedLocale } from "./locale";
import { setMainWindow } from "./notifications";
import { initTheme } from "./theme";
import { initUpdater } from "./updater";
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  loadWindowBounds,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  saveWindowBounds,
} from "./window-state";

// Single instance
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

// Single window
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

app.on("before-quit", () => {
  cron.stopAll();
  void disposeAll();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.whenReady().then(() => {
  // Matches `appId` in electron-builder.yml.
  app.setAppUserModelId("com.orcastudio.imboss");

  initDatabase();
  registerIpcHandlers();
  initTheme();

  createWindow();

  cron.initCron();

  void purgeDisabledEmployeesOnStartup();

  void refreshModelStore(new AbortController().signal);

  if (app.isPackaged) initUpdater();
});

function createWindow(): void {
  const locale = getResolvedLocale();
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

async function purgeDisabledEmployeesOnStartup(): Promise<void> {
  try {
    const purged = purgeDisabledEmployees();
    for (const entry of purged) {
      await Promise.all(entry.sessionPaths.map(unlinkSessionFile));
      deleteAvatarFiles(entry.employeeId);
    }
  } catch (err) {
    console.error(
      "[startup] purge disabled employees failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
