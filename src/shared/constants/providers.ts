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

/** API protocol flavors supported for custom providers (`models.json` `api`). */
export const PROVIDER_API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;
