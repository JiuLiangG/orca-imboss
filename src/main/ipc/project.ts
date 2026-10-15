import { parseCommonProjects } from "@shared/constants/projects";
import { SettingKeys } from "@shared/constants/settings";
import { ipcMain } from "electron";
import { getSetting } from "../db/settings";

/**
 * Common-project IPC. `projects:list` reads the `app.commonProjects` setting
 * and re-normalizes it (stored values are never trusted): invalid entries and
 * duplicates are dropped, path fields must be absolute. Writes go through the
 * generic `settings:set` channel, mirroring `agent.userEnv`.
 */
export function registerProjectHandlers(): void {
  ipcMain.handle("projects:list", () =>
    parseCommonProjects(getSetting(SettingKeys.CommonProjects)),
  );
}
