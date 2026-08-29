import { app, BrowserWindow, shell } from "electron";
import { join } from "path";
import icon from "../../resources/icon.png?asset";
import { initDatabase } from "./db";
import { registerIpcHandlers, setupNativeTheme } from "./ipc";
import { getResolvedLocale } from "./locale";
import { initUpdater } from "./updater";

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

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function createWindow(): void {
  const locale = getResolvedLocale();

  const mainWindow = new BrowserWindow({
    width: 950,
    height: 670,
    minWidth: 800,
    minHeight: 600,
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

  createWindow();

  if (app.isPackaged) initUpdater();
});
