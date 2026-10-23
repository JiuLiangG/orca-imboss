import { app } from "electron";
import { ASSISTANT_ID } from "@shared/constants/employees";
import { READ_CHAT_PROMPT } from "@shared/constants/prompts";
import { materializeBuiltinSkills } from "./agent/builtin-skills";
import { refreshModelStore } from "./agent/model-runtime";
import { cancelRunRecovery, initRunRecovery } from "./agent/run-recovery";
import {
  disposeAll,
  readSessionActivity,
  wakeAgent,
} from "./agent/session-queue";
import { deleteAvatarFiles } from "./avatars";
import { applyPendingRestore } from "./backup";
import * as cron from "./cron";
import { getAgentRoot } from "./data-dir";
import { initDatabase } from "./db";
import { purgeDisabledEmployees } from "./db/employees";
import { unlinkSessionFile } from "./db/sessions";
import { applyStoredHttpProxy } from "./http-proxy";
import {
  registerImbFileHandler,
  registerImbFileScheme,
} from "./imb-file-protocol";
import { initIntegrations, shutdownIntegrations } from "./integrations";
import { registerIpcHandlers } from "./ipc";
import { initLocale } from "./locale";
import {
  createMainWindow,
  disposeTray,
  initTray,
  markQuitting,
  showMainWindow,
} from "./main-window";
import { stopAllMiniAppServers, syncMiniAppIndex } from "./mini-apps";
import { initTheme } from "./theme";
import { initUpdater } from "./updater";
import {
  initWindowShortcut,
  unregisterWindowShortcut,
} from "./window-shortcut";

// Keep the Pi SDK's own agent-dir defaults (MCP OAuth credentials and MCP logs)
// inside the app's isolated data dir instead of the host's `~/.pi/agent`. The
// app passes explicit `agentDir`/paths everywhere else, and the MCP extension's
// server discovery is supplied by the app's own `loadConfig`.
process.env.PI_CODING_AGENT_DIR = getAgentRoot();

// Must run before the `app` `ready` event (Electron requires it): registers the
// `imb-file:` scheme used by `<img>` to load attachment/avatar files directly.
registerImbFileScheme();

// Single instance
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

// A restore staged from Settings › Backup replaces the whole data folder, so it
// has to be applied before anything reads or creates it — and only in the
// process that actually owns the single-instance lock.
if (singleInstanceLock) {
  const restored = applyPendingRestore();
  if (restored) {
    console.log(
      `[backup] restored ${restored.restoredFrom}` +
        (restored.keptAt ? ` (previous data kept at ${restored.keptAt})` : ""),
    );
  }
}

/**
 * False until startup has created the window and the services behind it. The
 * OS can emit `activate` / `second-instance` while we are still initialising;
 * revealing the window then would build it before the database (locale, window
 * bounds) exists.
 */
let started = false;

// Single window. A second launch is "bring the app back", not "open another one"
// — the same entry point as the global shortcut and the tray icon, so a hidden
// or minimized window comes back instead of silently staying away.
app.on("second-instance", () => {
  if (!started) return;
  showMainWindow();
});

// No `window-all-closed` handler on purpose: closing the window only hides it
// (see `main-window.ts`), so the app keeps running in the tray. Quitting is
// explicit — tray menu, the app menu / Cmd+Q, or `app.quit()` from an update
// install or a backup restore.

app.on("before-quit", () => {
  // Let the window's `close` handler really close (it hides instead otherwise).
  markQuitting();
  unregisterWindowShortcut();
  disposeTray();
  cancelRunRecovery();
  cron.stopAll();
  stopAllMiniAppServers();
  void disposeAll();
  void shutdownIntegrations();
});

// macOS: clicking the Dock icon (or being reactivated) must bring a hidden
// window back; `showMainWindow()` also re-creates it when there is none.
app.on("activate", () => {
  if (!started) return;
  showMainWindow();
});

app.whenReady().then(() => {
  // Matches `appId` in electron-builder.yml.
  app.setAppUserModelId("com.orcastudio.imboss");

  initDatabase();
  // Apply the persisted outbound proxy before any network work (integrations,
  // model-catalog refresh, provider "Fetch models") so it takes effect from the
  // very first request.
  applyStoredHttpProxy();
  // Localize main-process strings (native dialogs, OS notifications) from the
  // stored/system locale. Must run after the database is available.
  initLocale();
  // Generate the app's built-in Skills (hidden from Settings › Skills) so the
  // assistant's sessions can load them. Best-effort: a failure is logged and
  // never blocks startup.
  materializeBuiltinSkills();
  registerIpcHandlers();
  initTheme();

  // Serve `imb-file:` requests (attachment / avatar images). Must be registered
  // before the first window loads.
  registerImbFileHandler();

  // Start enabled IM integrations (WeChat / QQ / Telegram) in the background.
  void initIntegrations();

  createMainWindow();
  // Tray icon: the second entry point for showing a hidden window, and the only
  // way to quit with the window hidden on Windows / Linux.
  initTray();
  started = true;

  // Keep `index.json` in sync (append new apps, prune stale ids).
  void syncMiniAppIndex();

  cron.initCron();

  // Retry a human turn whose agent run never finished because the app quit,
  // crashed or was killed: one delayed, bounded pass that only wakes the
  // assistant to re-read those chats. It never makes up a missed cron time
  // point (cron wakes leave no `messages` row to recover from) — see
  // `agent/run-recovery.ts`.
  initRunRecovery({
    isStreaming: (chatId) =>
      readSessionActivity(ASSISTANT_ID, chatId).streaming,
    wake: (chatId) =>
      wakeAgent(ASSISTANT_ID, chatId, READ_CHAT_PROMPT, { mode: "queue" }),
  });

  // Register the global show/hide shortcut (after the database, so the stored
  // accelerator is readable). A registration failure is surfaced in
  // Settings › General instead of being fatal.
  initWindowShortcut();

  void purgeDisabledEmployeesOnStartup();

  void refreshModelStore(new AbortController().signal);

  // Always initialize the updater: the automatic startup check is packaged-only
  // (inside `initUpdater`), but the renderer's manual check also works in dev.
  initUpdater();
});

async function purgeDisabledEmployeesOnStartup(): Promise<void> {
  try {
    const purged = purgeDisabledEmployees();
    for (const entry of purged) {
      // The employee row (and its `cron_jobs` via FK cascade) is already gone;
      // stop the corresponding live Cron handles so they cannot keep firing.
      cron.stopJobsForEmployee(entry.employeeId);
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
