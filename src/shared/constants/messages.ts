/**
 * Message kinds that are app-generated notices rather than conversation.
 *
 * - `ack` — the receipt the app posts right after a user message (its stored
 *   content is empty; its label is localized at render time);
 * - `interrupted` — the record that the boss halted a task group;
 * - `error` — the record that an agent run failed (its `content` carries raw
 *   technical detail, which belongs to the notice's expandable detail — never
 *   to a one-line chat-list teaser).
 *
 * They are skipped when deriving a chat's list preview, so such a chat keeps
 * showing its last real message instead of an unreadable or empty notice. Kept
 * in one place because the preview is built by several queries that must agree.
 *
 * Deliberately **not** applied to message search, which only skips `ack`: an
 * `error` detail is legitimate searchable content, and narrowing that result
 * set would be a behaviour change unrelated to how a preview reads.
 */
export const PREVIEW_SKIP_KINDS = ["ack", "interrupted", "error"] as const;
