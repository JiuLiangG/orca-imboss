/**
 * Thinking (reasoning) strength levels shared by renderer and main.
 *
 * Mirrors the Pi SDK's `ThinkingLevel`
 * (`@earendil-works/pi-agent-core`, not re-exported by the package root):
 * `"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`.
 * The app only exposes a curated subset in its UI (minimal/xhigh handled via
 * the full SDK set for storage safety); the SDK clamps any value to the
 * selected model's capabilities at session build time.
 */
export const THINKING_LEVELS = [
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Fallback when nothing is configured (matches the SDK default). */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

/**
 * i18n dictionary keys for each level's display label (English key =
 * dictionary key, see `src/shared/l10n.ts`). Kept here so every thinking-level
 * select renders identical wording.
 */
export const THINKING_LEVEL_LABEL_KEYS: Record<ThinkingLevel, string> = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

/**
 * Type guard for persisted values (settings KV / `employees.thinking_level`).
 * Unknown or corrupt values must fall back to "unset" instead of throwing.
 */
export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    typeof value === "string" &&
    (THINKING_LEVELS as readonly string[]).includes(value)
  );
}
