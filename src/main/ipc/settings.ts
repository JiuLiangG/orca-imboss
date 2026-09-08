import { app, ipcMain } from "electron";
import { getSetting, setSetting } from "../db/settings";
import { assertString } from "./helpers";

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", (_event, key: unknown) =>
    getSetting(assertString(key, "key")),
  );

  ipcMain.handle("settings:set", (_event, key: unknown, value: unknown) => {
    setSetting(assertString(key, "key"), assertString(value, "value"));
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());
}
