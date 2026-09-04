import { ipcMain } from "electron";
import {
  getThemeState,
  sanitizeMode,
  setThemeColor,
  setThemeMode,
} from "../theme";

export function registerThemeHandlers(): void {
  ipcMain.handle("theme:get", () => getThemeState());

  ipcMain.handle("theme:set", (_event, patch: unknown) => {
    if (typeof patch !== "object" || patch === null) {
      throw new Error("theme patch must be an object.");
    }
    const record = patch as Record<string, unknown>;
    if (record["mode"] !== undefined) {
      const mode = sanitizeMode(
        typeof record["mode"] === "string" ? record["mode"] : undefined,
      );
      setThemeMode(mode);
    }
    if (record["color"] !== undefined) {
      if (typeof record["color"] !== "string") {
        throw new Error("theme color must be a string.");
      }
      setThemeColor(record["color"]);
    }
    const state = getThemeState();
    return state;
  });
}
