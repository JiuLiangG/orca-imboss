import { SettingKeys } from "@shared/constants/settings";
import { t } from "@shared/l10n";
import { ipcMain } from "electron";
import { mkdirSync } from "fs";
import { isAbsolute } from "path";
import { getWorkDirState } from "../agent/workdir";
import { setSetting } from "../db/settings";
import { showOpenDialog } from "./dialog";

/**
 * Working directory IPC.
 *
 * The renderer only ever reads the current state or asks the main process to
 * choose a directory — validation, creation and persistence all happen here so
 * a bad path can never reach the database. Selection is exclusive to the native
 * dialog, which always yields an absolute path.
 */
export function registerWorkdirHandlers(): void {
  ipcMain.handle("workdir:get", () => getWorkDirState());

  ipcMain.handle("workdir:choose", async () => {
    const before = getWorkDirState();
    const paths = await showOpenDialog({
      title: t("Select working directory"),
      defaultPath: before.effective,
      properties: ["openDirectory", "createDirectory"],
    });
    if (!paths) return null;
    const chosen = paths[0];
    if (!chosen || !isAbsolute(chosen)) {
      throw new Error("Selected working directory must be an absolute path.");
    }
    // Validate + create + persist atomically so a bad path never lands in the DB.
    mkdirSync(chosen, { recursive: true });
    setSetting(SettingKeys.WorkDir, chosen);
    return getWorkDirState();
  });
}
