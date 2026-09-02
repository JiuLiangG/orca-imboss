import type {
  Chat,
  ChatParticipantUpdate,
  ChatSummary,
  PageQuery,
  PageResult,
} from "../../../shared/types";
import { getDB } from "../index";
import { parseNumberArray, stringifyArray } from "./json";
import { escapeLike, toFtsPhrase } from "./text-search";

interface ChatRow {
  id: number;
  title: string;
  participants: string;
  unread: number;
  created_at: number;
}

function toChat(row: ChatRow): Chat {
  return {
    id: row.id,
    title: row.title ?? "",
    participants: parseNumberArray(row.participants),
    unread: row.unread ?? 0,
    createdAt: row.created_at,
  };
}

interface ChatSummaryRow extends ChatRow {
  preview: string | null;
  last_at: number | null;
}

function toChatSummary(row: ChatSummaryRow): ChatSummary {
  return { ...toChat(row), preview: row.preview, lastAt: row.last_at };
}

const SELECT_ALL = "SELECT * FROM chats ORDER BY created_at DESC, id DESC";

export function listChats(): Chat[] {
  return (getDB().prepare(SELECT_ALL).all() as ChatRow[]).map(toChat);
}

export function getChat(id: number): Chat | null {
  const row = getDB().prepare("SELECT * FROM chats WHERE id = ?").get(id) as
    ChatRow | undefined;
  return row ? toChat(row) : null;
}

/**
 * Chat list with the latest-message preview (chat module). Ordered by chat
 * creation date — newest first.
 */
export function listChatSummaries(): ChatSummary[] {
  const rows = getDB()
    .prepare(
      `SELECT c.id, c.title, c.participants, c.unread, c.created_at,
              (SELECT m.content FROM messages m WHERE m.chat_id = c.id
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS preview,
              (SELECT m.created_at FROM messages m WHERE m.chat_id = c.id
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_at
       FROM chats c
       ORDER BY c.created_at DESC, c.id DESC`,
    )
    .all() as ChatSummaryRow[];
  return rows.map(toChatSummary);
}

/** Clear a chat's unread counter (opening the chat). */
export function markRead(id: number): void {
  getDB().prepare("UPDATE chats SET unread = 0 WHERE id = ?").run(id);
}

/** Increment the unread counter (messages from employees). */
export function bumpUnread(id: number): void {
  getDB().prepare("UPDATE chats SET unread = unread + 1 WHERE id = ?").run(id);
}

/**
 * Add a (non-negative) delta to a chat's unread counter and return the new
 * value. The delta is clamped to `>= 0` (a negative delta never underflows
 * below zero; `markRead` is the explicit clear path).
 */
export function addUnread(id: number, delta: number): number {
  const numeric = Number(delta);
  const safeDelta = Number.isFinite(numeric)
    ? Math.max(0, Math.trunc(numeric))
    : 0;
  getDB()
    .prepare("UPDATE chats SET unread = max(0, unread + ?) WHERE id = ?")
    .run(safeDelta, id);
  const row = getDB()
    .prepare("SELECT unread FROM chats WHERE id = ?")
    .get(id) as { unread: number } | undefined;
  return row?.unread ?? 0;
}

// --- paged chat list (keyset cursor over `(created_at, id) DESC`) -----------

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_QUERY_LENGTH = 200;

/** Cursor payload: `"<createdAt>:<id>"` of the last row of the previous page. */
function encodeChatCursor(createdAt: number, id: number): string {
  return `${createdAt}:${id}`;
}

function decodeChatCursor(cursor: string): {
  createdAt: number;
  id: number;
} | null {
  const split = cursor.lastIndexOf(":");
  if (split <= 0) return null;
  const createdAt = Number(cursor.slice(0, split));
  const id = Number(cursor.slice(split + 1));
  if (!Number.isFinite(createdAt) || !Number.isSafeInteger(id)) return null;
  return { createdAt, id };
}

/**
 * One page of chat summaries, ordered `created_at DESC, id DESC` (unchanged
 * from the full list). Search semantics (pushes the module's client-side
 * filter to the server):
 * - `query.length >= 3` → title LIKE  **OR** FTS5 trigram match over any
 *   message content (phrase-quoted, same as `searchMessages`);
 * - shorter queries → title LIKE **OR** plain `content LIKE` scan (no
 *   trigram index; keeps 1–2 char / Chinese queries working).
 *
 * Cursor stability: seeks with the row-value comparison `(created_at, id) <`
 * so inserts/deletes during scrolling never skip or duplicate rows.
 */
export function listChatSummariesPage(
  page: PageQuery = {},
): PageResult<ChatSummary> {
  const limit = Math.min(
    Math.max(Math.trunc(page.limit ?? DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );
  const needle = (page.query ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const db = getDB();
  const params: Array<string | number> = [];
  const conditions: string[] = [];

  // Keyset seek — always the first predicate so the index is usable.
  if (page.cursor) {
    const cursor = decodeChatCursor(page.cursor);
    if (cursor) {
      conditions.push("(c.created_at, c.id) < (?, ?)");
      params.push(cursor.createdAt, cursor.id);
    }
  }

  if (needle.length > 0) {
    const pattern = `%${escapeLike(needle)}%`;
    if (needle.length >= 3) {
      conditions.push(
        "(c.title LIKE ? ESCAPE '\\' OR c.id IN " +
          "(SELECT DISTINCT m.chat_id FROM messages_fts " +
          " JOIN messages m ON m.id = messages_fts.rowid " +
          " WHERE messages_fts MATCH ?))",
      );
      params.push(pattern, toFtsPhrase(needle));
    } else {
      conditions.push(
        "(c.title LIKE ? ESCAPE '\\' OR c.id IN " +
          "(SELECT DISTINCT chat_id FROM messages WHERE content LIKE ? ESCAPE '\\'))",
      );
      params.push(pattern, pattern);
    }
  }

  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.participants, c.unread, c.created_at,
              (SELECT m.content FROM messages m WHERE m.chat_id = c.id
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS preview,
              (SELECT m.created_at FROM messages m WHERE m.chat_id = c.id
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_at
       FROM chats c
       WHERE ${conditions.length > 0 ? conditions.join(" AND ") : "1 = 1"}
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ?`,
    )
    .all(...params, limit + 1) as ChatSummaryRow[];

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(toChatSummary);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last ? encodeChatCursor(last.createdAt, last.id) : null,
    hasMore,
  };
}

/**
 * Create a group chat. Participants referencing unknown employees are
 * dropped defensively (participants is a JSON column, not FK-enforced).
 */
export function createChat(title: string, participants: number[]): Chat {
  const db = getDB();
  const safeTitle = title.trim();
  if (safeTitle.length > 200) throw new Error("Chat title is too long.");

  const knownIds = new Set(
    (db.prepare("SELECT id FROM employees").all() as Array<{ id: number }>).map(
      (row) => row.id,
    ),
  );
  const unique = [...new Set(participants)].filter((id) => knownIds.has(id));

  // Guard against `lastInsertRowid` ever handing out our reserved-ish
  // sequence unexpectedly: chats start at 1 (assistant id 0 lives elsewhere).
  const result = db
    .prepare(
      "INSERT INTO chats (title, participants, created_at) VALUES (?, ?, ?)",
    )
    .run(safeTitle, stringifyArray(unique), Math.floor(Date.now() / 1000));
  return getChat(Number(result.lastInsertRowid)) as Chat;
}

export function updateChatTitle(id: number, title: string): Chat | null {
  const safeTitle = title.trim();
  if (safeTitle.length > 200) throw new Error("Chat title is too long.");
  getDB().prepare("UPDATE chats SET title = ? WHERE id = ?").run(safeTitle, id);
  return getChat(id);
}

/**
 * Delete a chat. Messages and session rows cascade via foreign keys; callers
 * are responsible for cleaning up the corresponding disk session files.
 */
export function deleteChat(id: number): boolean {
  return getDB().prepare("DELETE FROM chats WHERE id = ?").run(id).changes > 0;
}

/** Apply additive/removal participant edits with duplicate-tolerant merging. */
export function updateChatParticipants(
  id: number,
  changes: ChatParticipantUpdate,
): Chat | null {
  const chat = getChat(id);
  if (!chat) return null;
  const knownIds = new Set(
    (
      getDB().prepare("SELECT id FROM employees").all() as Array<{
        id: number;
      }>
    ).map((row) => row.id),
  );
  let participants = new Set(chat.participants);
  for (const pid of changes.add ?? []) {
    if (knownIds.has(pid)) participants.add(pid);
  }
  for (const pid of changes.remove ?? []) {
    participants.delete(pid);
  }
  getDB()
    .prepare("UPDATE chats SET participants = ? WHERE id = ?")
    .run(stringifyArray([...participants]), id);
  return getChat(id);
}
