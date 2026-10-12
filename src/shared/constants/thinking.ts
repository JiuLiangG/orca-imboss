/**
 * Thinking (reasoning) strength levels shared by renderer and main.
 *
 * This is Pi's `ModelThinkingLevel` order
 * (`off | minimal | low | medium | high | xhigh | max`). Which of these a
 * given model actually accepts comes from that model's `thinkingLevelMap`
 * (`null` drops the level; `xhigh` and `max` count only when the map names
 * them). The SDK still clamps a stored value onto the model at request time.
 */
export const THINKING_LEVELS = [
  "off",
  "minimal",
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
  minimal: "Minimal",
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
