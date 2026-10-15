import { MAX_TAGS_PER_CHAT, normalizeTag } from "@shared/constants/tags";
import { t } from "@shared/l10n";
import { useMemo } from "react";
import { MultiSelect } from "../multi-select";

export interface TagSelectProps {
  value: string[];
  /** Candidate tags (usually from `imb.tags.list()`). */
  options: string[];
  onChange: (value: string[]) => void;
  /** Allow creating a new tag from the panel's filter text (editor mode). */
  allowCreate?: boolean;
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
  placeholder = "",
  disabled = false,
  noClear = false,
  className,
  id,
}: TagSelectProps): React.JSX.Element {
  // A just-created tag may not be in the (refetched) candidate list yet; merge
  // the selected values in so their chips always render.
  const merged = useMemo(() => {
    const missing = value.filter((tag) => !options.includes(tag));
    return missing.length > 0 ? [...options, ...missing] : options;
  }, [options, value]);
  const multiOptions = useMemo(
    () => merged.map((tag) => ({ value: tag, label: `#${tag}` })),
    [merged],
  );

  function handleCreate(text: string): void {
    const tag = normalizeTag(text);
    if (tag.length === 0 || value.includes(tag)) return;
    if (value.length >= MAX_TAGS_PER_CHAT) return;
    onChange([...value, tag]);
  }

  return (
    <MultiSelect
      id={id}
      className={className}
      value={value}
      options={multiOptions}
      onChange={onChange}
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
