/** Providers offered in the settings dropdown in addition to "Custom". */
export const CURATED_PROVIDERS = [
  "anthropic",
  "deepseek",
  "github-copilot",
  "google",
  "groq",
  "minimax-cn",
  "minimax",
  "moonshotai-cn",
  "moonshotai",
  "openai",
  "opencode",
  "opencode-go",
  "openrouter",
  "xai",
  "xiaomi",
  "zai",
] as const;

/** Names for the providers to display in UI */
export const CURATED_PROVIDERS_LABELS = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  "github-copilot": "GitHub Copilot",
  google: "Google",
  groq: "Groq",
  "minimax-cn": "MiniMax (CN)",
  minimax: "MiniMax",
  "moonshotai-cn": "Moonshot AI (CN)",
  moonshotai: "Moonshot AI",
  openai: "OpenAI",
  opencode: "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  openrouter: "OpenRouter",
  xai: "xAI",
  xiaomi: "Xiaomi",
  zai: "Z.ai",
} as const;

/**
 * Built-in providers whose Pi auth includes a subscription OAuth login.
 * imboss only drives the device-code flow these use; other Pi OAuth
 * providers that prompt for a secret or a callback stay API-key only.
 */
export const SUBSCRIPTION_LOGIN_PROVIDERS = ["xai"] as const;

export type SubscriptionLoginProvider =
  (typeof SUBSCRIPTION_LOGIN_PROVIDERS)[number];

/** Pi's own login label for each subscription provider. */
export const SUBSCRIPTION_LOGIN_LABELS: Record<
  SubscriptionLoginProvider,
  string
> = {
  xai: "Sign in with SuperGrok or X Premium",
};

/**
 * i18n key shown when the xAI device-code request never connects (timeout,
 * DNS failure, connection refused). HTTP responses from auth.x.ai are a
 * different failure and keep their own message.
 */
export const XAI_UNREACHABLE =
  "Could not connect to auth.x.ai. Check that the proxy in Settings → Network is usable.";

export function isSubscriptionLoginProvider(
  id: string,
): id is SubscriptionLoginProvider {
  return (SUBSCRIPTION_LOGIN_PROVIDERS as readonly string[]).includes(id);
}

/** API protocol flavors supported for custom providers (`models.json` `api`). */
export const PROVIDER_API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;
