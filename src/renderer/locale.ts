import { SettingKeys } from "@shared/constants/settings";
import { setupL10N } from "@shared/l10n";
import zhCN from "@shared/translations/zhCN.json";
import { appStore } from "./app-store";

export const TRANSLATIONS = { "zh-CN": zhCN };

export async function setLocale(value: string): Promise<void> {
  await imb.settings.set(SettingKeys.Locale, value);
  setupL10N(value, TRANSLATIONS);
  appStore.locale = value;
}

export function updateLocale(value: string): void {
  setupL10N(value, TRANSLATIONS);
  appStore.locale = value;
}
