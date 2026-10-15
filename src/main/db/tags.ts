import { normalizeTags } from "@shared/constants/tags";
import { getDB } from "./index";

/**
 * Conversation tags (`chat_tags`, migration 3). Tags are stored one row per
 * (chat, tag); the table cascades on chat delete, so removing a chat never
 * leaves orphan tags behind. There is no separate tag dictionary — the
 * candidate list is derived from the distinct tags currently in use.
 *
 * Tags are stored normalized (trimmed, whitespace-collapsed, length-capped)
 * and case-sensitively: `Work` and `work` are two distinct tags.
 */

/** Every tag currently in use, case-insensitively sorted (stable tie-break). */
export function listTags(): string[] {
  const rows = getDB()
    .prepare(
      "SELECT DISTINCT tag FROM chat_tags ORDER BY tag COLLATE NOCASE ASC, tag ASC",
    )
    .all() as Array<{ tag: string }>;
  return rows.map((row) => row.tag);
}

/** One chat's tags, in insertion order (the order they were added). */
export function tagsForChat(chatId: number): string[] {
  return (
    getDB()
      .prepare(
        "SELECT tag FROM chat_tags WHERE chat_id = ? ORDER BY rowid ASC",
      )
      .all(chatId) as Array<{ tag: string }>
  ).map((row) => row.tag);
}

/**
 * Tags for many chats at once, keyed by chat id (only chats that have tags
 * appear in the returned map). Used by the list/summary queries so they can
 * enrich a page of rows with one extra query instead of N.
 */
export function tagsForChats(ids: readonly number[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  const unique = [...new Set(ids)].filter((id) =>
    Number.isSafeInteger(id),
  );
  if (unique.length === 0) return result;
  const placeholders = unique.map(() => "?").join(", ");
  const rows = getDB()
    .prepare(
      `SELECT chat_id, tag FROM chat_tags WHERE chat_id IN (${placeholders})
       ORDER BY chat_id ASC, rowid ASC`,
    )
    .all(...unique) as Array<{ chat_id: number; tag: string }>;
  for (const row of rows) {
    const list = result.get(row.chat_id);
    if (list) {
      list.push(row.tag);
    } else {
      result.set(row.chat_id, [row.tag]);
    }
  }
  return result;
}

/**
 * Replace one chat's tags atomically. Input is normalized, deduped and capped.
 * Returns `false` when the chat does not exist (nothing is written); otherwise
 * `true`.
 */
export function setChatTags(chatId: number, tags: readonly string[]): boolean {
  const db = getDB();
  const exists =
    db.prepare("SELECT 1 FROM chats WHERE id = ?").get(chatId) !== undefined;
  if (!exists) return false;
  const normalized = normalizeTags(tags);
  const remove = db.prepare("DELETE FROM chat_tags WHERE chat_id = ?");
  const insert = db.prepare(
    "INSERT OR IGNORE INTO chat_tags (chat_id, tag) VALUES (?, ?)",
  );
  db.transaction(() => {
    remove.run(chatId);
    for (const tag of normalized) insert.run(chatId, tag);
  })();
  return true;
}
