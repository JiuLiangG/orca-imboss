/**
 * Text-search helpers shared by the message FTS search and the chat list
 * page query (title OR message-content matching). Kept in a leaf module so
 * `chats.ts` (which also owns the paged chat query) never has to import
 * `messages.ts` — that file already imports `chats.ts` for `bumpUnread`.
 */

/** Escape `LIKE` wildcards so user input matches literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Wrap user input as a literal FTS5 phrase query: quote it and escape inner
 * quotes (`"` → `""`) so punctuation is treated as plain text.
 */
export function toFtsPhrase(needle: string): string {
  return `"${needle.replace(/"/g, '""')}"`;
}
