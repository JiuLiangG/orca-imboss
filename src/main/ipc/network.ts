import { SettingKeys } from "@shared/constants/settings";
import { ipcMain } from "electron";
import { getSetting, setSetting } from "../db/settings";
import { applyHttpProxy, normalizeProxyUrl } from "../http-proxy";
import { assertString } from "./helpers";

/**
 * Settings → Network handlers. The proxy value is stored in the app's SQLite
 * settings table and applied to the main process immediately (no restart).
 */
export function registerNetworkHandlers(): void {
  ipcMain.handle(
    "network:getProxy",
    () => getSetting(SettingKeys.HttpProxy) ?? "",
  );

  ipcMain.handle("network:setProxy", (_event, value: unknown) => {
    const raw = assertString(value, "proxy");
    // Validate before persisting so an invalid value is never stored.
    const url = normalizeProxyUrl(raw);
    setSetting(SettingKeys.HttpProxy, url ?? "");
    applyHttpProxy(url);
  });
}
