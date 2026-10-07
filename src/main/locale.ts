import { SettingKeys } from "@shared/constants/settings";
import { setupL10N } from "@shared/l10n";
import zhCN from "@shared/translations/zhCN.json";
import { app } from "electron";
import { getSetting } from "./db/settings";

const TRANSLATIONS = { "zh-CN": zhCN };

export function getResolvedLocale(): string {
  const stored = getSetting(SettingKeys.Locale);
  if (stored) {
    return stored;
  }
  return app.getLocale();
}

/**
 * Initialize main-process translations from the resolved locale. Call once
 * after the database is ready and before any native dialog or OS notification
 * is shown. The renderer owns live locale switches; main strings (native
 * dialogs, update notifications) are resolved at startup.
 */
export function initLocale(): void {
  setupL10N(getResolvedLocale(), TRANSLATIONS);
}
