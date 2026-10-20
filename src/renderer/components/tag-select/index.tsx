import {
  MAX_TAGS_PER_CHAT,
  normalizeTag,
  TAG_FILTER_NONE,
} from "@shared/constants/tags";
import { t } from "@shared/l10n";
import { useMemo } from "react";
import { MultiSelect, type MultiSelectOption } from "../multi-select";

/**
 * Candidate list of a tag picker, as `MultiSelect` options.
 *
 * Selected values missing from `options` are appended, so a tag that was just
 * created (or deleted elsewhere) still renders as a chip. With `allowNoTag` the
 * "No tags" pseudo-value is injected exactly once at the top, rendered as plain
 * `t("No tags")` text (no `#` prefix). Shared by `TagSelect` and by owners that
 * drive the panel themselves (e.g. the chat list's `FilterBar`).
 */
export function buildTagFilterOptions(
  options: readonly string[],
  selected: readonly string[],
  allowNoTag = false,
): MultiSelectOption[] {
  const missing = selected.filter(
    (tag) => tag !== TAG_FILTER_NONE && !options.includes(tag),
  );
  const base = missing.length > 0 ? [...options, ...missing] : [...options];
  const values = allowNoTag ? [TAG_FILTER_NONE, ...base] : base;
  return values.map((tag) => ({
    value: tag,
    label: tag === TAG_FILTER_NONE ? t("No tags") : `#${tag}`,
  }));
}

/**
 * Keep the "No tags" pseudo-value and the concrete tags mutually exclusive
 * (both directions): picking one side drops the other. The filters are
 * AND-combined, so mixing both would always match nothing.
 */
export function applyNoTagExclusion(
  current: readonly string[],
  next: readonly string[],
): string[] {
  const hadNoTag = current.includes(TAG_FILTER_NONE);
  const hasNoTag = next.includes(TAG_FILTER_NONE);
  const real = next.filter((tag) => tag !== TAG_FILTER_NONE);
  // "No tags" just got picked → drop the concrete tags.
  if (hasNoTag && !hadNoTag) return [TAG_FILTER_NONE];
  // A concrete tag got picked while "No tags" was on → it replaces it.
  if (hasNoTag && hadNoTag && real.length > 0) return real;
  return [...next];
}

export interface TagSelectProps {
  value: string[];
  /** Candidate tags (usually from `imb.tags.list()`). */
  options: string[];
  onChange: (value: string[]) => void;
  /** Allow creating a new tag from the panel's filter text (editor mode). */
  allowCreate?: boolean;
  /**
   * Add a "No tags" pseudo-option at the top of the candidate list (filter
   * mode only — editors must not offer it). Selecting it clears the selected
   * concrete tags and vice versa (mutual exclusion), because the filters are
   * AND-combined and mixing both would always match nothing. The option
   * renders as plain `t("No tags")` text — no `#` prefix, no extra styling.
   */
  allowNoTag?: boolean;
  placeholder?: string;
  disabled?: boolean;
  noClear?: boolean;
  /** Extra class on the root (e.g. a compact trigger inside a list row). */
  className?: string;
  id?: string;
}

/**
 * Multi-select over conversation tags: the one `MultiSelect` component fed
 * with tag candidates (rendered as `#tag`), plus the tag-specific semantics —
 * normalization / de-duplication / per-conversation cap on create, and an
 * empty hint. Reused by the per-conversation editor and both tag filters.
 */
export function TagSelect({
  value,
  options,
  onChange,
  allowCreate = false,
  allowNoTag = false,
  placeholder = "",
  disabled = false,
  noClear = false,
  className,
  id,
}: TagSelectProps): React.JSX.Element {
  // A just-created tag may not be in the (refetched) candidate list yet; merge
  // the selected values in so their chips always render. The "No tags" pseudo
  // value is excluded here and re-injected exactly once by the builder.
  const multiOptions = useMemo(
    () => buildTagFilterOptions(options, value, allowNoTag),
    [options, value, allowNoTag],
  );

  /**
   * Route every value change through here so the "No tags" pseudo-option and
   * the concrete tags stay mutually exclusive (both directions). Without
   * `allowNoTag` this is a straight pass-through, so editor behaviour is
   * unchanged.
   */
  function handleChange(next: string[]): void {
    onChange(allowNoTag ? applyNoTagExclusion(value, next) : next);
  }

  function handleCreate(text: string): void {
    const tag = normalizeTag(text);
    if (tag.length === 0 || value.includes(tag)) return;
    if (value.length >= MAX_TAGS_PER_CHAT) return;
    handleChange([...value, tag]);
  }

  return (
    <MultiSelect
      id={id}
      className={className}
      value={value}
      options={multiOptions}
      onChange={handleChange}
      searchable
      clearable={!noClear}
      searchPlaceholder={t("Search tags")}
      onSearchCreate={allowCreate ? handleCreate : undefined}
      maxSelected={MAX_TAGS_PER_CHAT}
      placeholder={placeholder}
      emptyHint={t("No tags yet")}
      disabled={disabled}
    />
  );
}
