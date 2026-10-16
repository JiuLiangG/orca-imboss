/**
 * Conversation tags (`chat_tags` table). A tag is free-form text the user
 * types; the candidate list is derived from the tags already in use, so there
 * is deliberately no separate tag dictionary to manage.
 */

/** Maximum length of one tag, in characters, after normalization. */
export const MAX_TAG_LENGTH = 50;

/** Maximum number of tags a single conversation can carry. */
export const MAX_TAGS_PER_CHAT = 20;

/**
 * Pseudo-value of the "No tags" option inside a tag **filter** (never a real
 * tag). Stored in the same `string[]` as the selected concrete tags so the
 * existing filter plumbing (`length > 0`, reset keys, clear-all) needs no
 * special case; consumers strip it and translate it to a dedicated predicate
 * (`PageQuery.noTags` on the server, `chat.tags.length === 0` in spend).
 *
 * `""` is safe as a sentinel because a real tag can never be blank:
 * `normalizeTag()` / `parsePageQuery()` both drop whitespace-only values, and
 * the filter state itself never passes through normalization.
 */
export const TAG_FILTER_NONE = "";

/**
 * Normalize a raw tag the user typed: collapse control characters and runs of
 * whitespace, then trim and cap the length. Case is preserved on purpose —
 * `Work` and `work` are two distinct tags.
 *
 * Returns `""` when nothing but whitespace was supplied (the caller drops it).
 */
export function normalizeTag(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LENGTH)
    .trim();
}

/**
 * Normalize a list of raw tags: normalize each, drop empties, drop exact
 * duplicates (first occurrence wins) and cap to `MAX_TAGS_PER_CHAT`.
 */
export function normalizeTags(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (tag.length === 0 || result.includes(tag)) continue;
    result.push(tag);
    if (result.length >= MAX_TAGS_PER_CHAT) break;
  }
  return result;
}
