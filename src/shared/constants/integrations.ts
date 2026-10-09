import type { IntegrationPlatform } from "@shared/types/integrations";

/** Canonical order used by the Settings → Integrations page. */
export const INTEGRATION_PLATFORMS: IntegrationPlatform[] = [
  "wechat",
  "qq",
  "telegram",
];

/** English source label key for each platform (translated via `t()`). */
export const INTEGRATION_LABEL_KEYS: Record<IntegrationPlatform, string> = {
  wechat: "WeChat",
  qq: "QQ",
  telegram: "Telegram",
};

/**
 * Official documentation opened by each platform's connect guide. Opened in the
 * OS browser via a plain `<a target="_blank">` (main forwards safe schemes).
 */
export const INTEGRATION_DOC_URLS: Record<IntegrationPlatform, string> = {
  wechat: "",
  qq: "https://bot.q.qq.com/wiki/",
  telegram: "https://core.telegram.org/bots/features",
};

/** English source key for each platform's short one-line description. */
export const INTEGRATION_DESC_KEYS: Record<IntegrationPlatform, string> = {
  wechat: "Connect personal WeChat via the official iLink Bot",
  qq: "Connect QQ via the official QQ Bot platform",
  telegram: "Connect Telegram via a @BotFather bot",
};
