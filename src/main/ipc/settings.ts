import { app, ipcMain } from "electron";
import { getSetting, setSetting } from "../db/services/settings";
import { getResolvedLocale } from "../locale";
import { assertString } from "./helpers";

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", (_event, key: unknown) =>
    getSetting(assertString(key, "key")),
  );

  ipcMain.handle("settings:set", (_event, key: unknown, value: unknown) => {
    setSetting(assertString(key, "key"), assertString(value, "value"));
  });

  ipcMain.handle("locale:get", () => getResolvedLocale());

  ipcMain.handle("locale:set", (_event, locale: unknown) => {
    const newLocale = assertString(locale, "locale");
    setSetting("locale", newLocale);
    return newLocale;
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());
}
