import {
  isThinkingLevel,
  THINKING_LEVELS,
  THINKING_LEVEL_LABEL_KEYS,
  type ThinkingLevel,
} from "@shared/constants/thinking";
import { t } from "@shared/l10n";
import type { ModelOption } from "@shared/types";
import type { SelectOption } from "./components/select";

export function modelRef(model: ModelOption): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Levels to offer for `modelId`. An empty id uses `fallbackModelId` (the app
 * default). When neither model is known, the union of every configured
 * model's levels is used, still in Pi's order.
 */
export function thinkingLevelsFor(
  models: readonly ModelOption[],
  modelId: string,
  fallbackModelId = "",
): ThinkingLevel[] {
  const target = modelId || fallbackModelId;
  if (target) {
    const match = models.find((model) => modelRef(model) === target);
    if (match && match.thinkingLevels.length > 0) return match.thinkingLevels;
  }
  const present = new Set(models.flatMap((model) => model.thinkingLevels));
  const union = THINKING_LEVELS.filter((level) => present.has(level));
  return union.length > 0 ? [...union] : [...THINKING_LEVELS];
}

/** Select rows for `levels`, keeping a stored value visible even if this model rejects it. */
export function thinkingSelectOptions(
  levels: readonly ThinkingLevel[],
  current: string,
): SelectOption[] {
  const values: ThinkingLevel[] = [...levels];
  if (isThinkingLevel(current) && !values.includes(current)) {
    values.push(current);
  }
  return values.map((level) => ({
    value: level,
    label: t(THINKING_LEVEL_LABEL_KEYS[level]),
  }));
}
