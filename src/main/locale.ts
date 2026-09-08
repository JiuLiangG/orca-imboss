import { SettingKeys } from "@shared/constants/settings";
import { app } from "electron";
import { getSetting } from "./db/settings";

export function getResolvedLocale(): string {
  const stored = getSetting(SettingKeys.Locale);
  if (stored) {
    return stored;
  }
  return app.getLocale();
}
