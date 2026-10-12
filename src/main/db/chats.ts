import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@shared/constants/paged";
import type {
  Chat,
  ChatParticipantUpdate,
  ChatRow,
  ChatSummary,
  ChatSummaryRow,
  PageQuery,
  PageResult,
} from "@shared/types";
import { getDB } from "./index";
import { parseNumberArray, stringifyArray } from "./json";
import { escapeLike, toFtsPhrase } from "./text-search";

const MAX_QUERY_LENGTH = 200;

export function listChats(): Chat[] {
  return (
    getDB()
      .prepare(
        "SELECT * FROM chats WHERE from_chat_id IS NULL " +
          "ORDER BY last_message_at DESC, id DESC",
      )
      .all() as ChatRow[]
  ).map(toChat);
}

export function getChat(id: number): Chat | null {
  const row = getDB().prepare("SELECT * FROM chats WHERE id = ?").get(id) as
    ChatRow | undefined;
  return row ? toChat(row) : null;
}

/**
 * Resolve the root (user) chat of a chat by walking `from_chat_id` upward.
 * Cycle-safe: a malformed self/circular chain returns the last id visited. A
 * root chat returns itself; an unknown chat returns the input id.
 */
export function getRootChatId(chatId: number): number {
  let current = chatId;
  const seen = new Set<number>();
  while (!seen.has(current)) {
    seen.add(current);
    const chat = getChat(current);
    if (!chat || chat.fromChatId === null) return current;
    current = chat.fromChatId;
  }
  return current;
}

/**
 * Chat list with the latest-message preview (chat module). Root-only
 * (assistant ↔ user); ordered by last-message time — newest first. A chat
 * that has never received a message falls back to its creation time (set on
 * insert, so a fresh chat tops the list).
 */
export function listChatSummaries(): ChatSummary[] {
  const rows = getDB()
    .prepare(
      `SELECT c.id, c.title, c.participants, c.unread, c.created_at, c.from_chat_id,
              c.source, c.last_message_at,
              (SELECT m.content FROM messages m
               WHERE m.chat_id = c.id AND m.kind <> 'ack'
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS preview,
              (SELECT m.created_at FROM messages m
               WHERE m.chat_id = c.id AND m.kind <> 'ack'
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_at
       FROM chats c
       WHERE c.from_chat_id IS NULL
       ORDER BY c.last_message_at DESC, c.id DESC`,
    )
    .all() as ChatSummaryRow[];
  return rows.map(toChatSummary);
}

/**
 * Single chat summary (any chat — root or group). The caller decides whether
 * to ignore non-root chats; used by the renderer's live per-chat refresh.
 */
export function getChatSummary(id: number): ChatSummary | null {
  const row = getDB()
    .prepare(
      `SELECT c.id, c.title, c.participants, c.unread, c.created_at, c.from_chat_id,
              c.source, c.last_message_at,
              (SELECT m.content FROM messages m
               WHERE m.chat_id = c.id AND m.kind <> 'ack'
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS preview,
              (SELECT m.created_at FROM messages m
               WHERE m.chat_id = c.id AND m.kind <> 'ack'
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_at
       FROM chats c
       WHERE c.id = ?`,
    )
    .get(id) as ChatSummaryRow | undefined;
  return row ? toChatSummary(row) : null;
}

/**
 * One page of chat summaries, root-only, ordered `last_message_at DESC,
 * id DESC` (same as the full list). Search semantics (pushes the module's
 * server-side FTS/LIKE filter):
 * - `query.length >= 3` → title LIKE  **OR** FTS5 trigram match over any
 *   message content (phrase-quoted, same as `searchMessages`);
 * - shorter queries → title LIKE **OR** plain `content LIKE` scan (no
 *   trigram index; keeps 1–2 char / Chinese queries working).
 *
 * Cursor stability: seeks with the row-value comparison `(last_message_at,
 * id) <` so inserts/deletes during scrolling never skip or duplicate rows.
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
  const conditions: string[] = ["c.from_chat_id IS NULL"];

  // Keyset seek — always the first predicate so the index is usable.
  if (page.cursor) {
    const cursor = decodeChatCursor(page.cursor);
    if (cursor) {
      conditions.push("(c.last_message_at, c.id) < (?, ?)");
      params.push(cursor.lastMessageAt, cursor.id);
    }
  }

  if (needle.length > 0) {
    const pattern = `%${escapeLike(needle)}%`;
    if (needle.length >= 3) {
      conditions.push(
        "(c.title LIKE ? ESCAPE '\\' OR c.id IN " +
          "(SELECT DISTINCT m.chat_id FROM messages_fts " +
          " JOIN messages m ON m.id = messages_fts.rowid " +
          " WHERE messages_fts MATCH ? AND m.kind <> 'ack'))",
      );
      params.push(pattern, toFtsPhrase(needle));
    } else {
      conditions.push(
        "(c.title LIKE ? ESCAPE '\\' OR c.id IN " +
          "(SELECT DISTINCT chat_id FROM messages WHERE content LIKE ? ESCAPE '\\' AND kind <> 'ack'))",
      );
      params.push(pattern, pattern);
    }
  }

  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.participants, c.unread, c.created_at, c.from_chat_id,
              c.source, c.last_message_at,
              (SELECT m.content FROM messages m
               WHERE m.chat_id = c.id AND m.kind <> 'ack'
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS preview,
              (SELECT m.created_at FROM messages m
               WHERE m.chat_id = c.id AND m.kind <> 'ack'
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_at
       FROM chats c
       WHERE ${conditions.join(" AND ")}
       ORDER BY c.last_message_at DESC, c.id DESC
       LIMIT ?`,
    )
    .all(...params, limit + 1) as ChatSummaryRow[];

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(toChatSummary);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last ? encodeChatCursor(last.lastMessageAt, last.id) : null,
    hasMore,
  };
}

/** Clear a chat's unread counter (opening the chat). */
export function markRead(id: number): void {
  getDB().prepare("UPDATE chats SET unread = 0 WHERE id = ?").run(id);
}

/**
 * Increment the unread counter (messages from employees).
 * Root chats only — callers must not bump task group chats (see
 * `notifyUnread` for the enforced variant); the guard lives at the call site
 * in `appendMessage`, which already knows the chat's root/group nature.
 */
export function bumpUnread(id: number): void {
  getDB().prepare("UPDATE chats SET unread = unread + 1 WHERE id = ?").run(id);
}

/**
 * Add a (non-negative) delta to a chat's unread counter and return the new
 * value. The delta is clamped to `>= 0` (a negative delta never underflows
 * below zero; `markRead` is the explicit clear path).
 * Root chats only — `notifyUnread` rejects task group chats before calling in.
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

export interface CreateChatOptions {
  /** Id of the chat that spawned this one; `null`/omitted = root chat. */
  fromChatId?: number | null;
  /** Platform this conversation is bridged to (IM integrations). */
  source?: string | null;
  /** Platform conversation id, stable per (source, session). */
  sourceSession?: string | null;
  /** Per-conversation reply credential (e.g. iLink `context_token`). */
  sourceContext?: string | null;
}

/**
 * Create a group chat. Participants referencing unknown employees are
 * dropped defensively (participants is a JSON column, not FK-enforced).
 */
export function createChat(
  title: string,
  participants: number[],
  options: CreateChatOptions = {},
): Chat {
  const { fromChatId } = options;
  const db = getDB();
  const safeTitle = title.trim();
  if (safeTitle.length > 200) throw new Error("Chat title is too long.");

  const knownIds = new Set(
    (db.prepare("SELECT id FROM employees").all() as Array<{ id: number }>).map(
      (row) => row.id,
    ),
  );
  const unique = [...new Set(participants)].filter((id) => knownIds.has(id));

  // Only a valid chat id is stored as `from`; otherwise the chat is a root.
  const safeFrom =
    fromChatId != null && Number.isSafeInteger(fromChatId) && fromChatId > 0
      ? fromChatId
      : null;
  const safeSource =
    typeof options.source === "string" && options.source.length > 0
      ? options.source
      : null;
  const safeSession =
    safeSource !== null &&
    typeof options.sourceSession === "string" &&
    options.sourceSession.length > 0
      ? options.sourceSession
      : null;
  const safeContext =
    safeSource !== null && typeof options.sourceContext === "string"
      ? options.sourceContext
      : null;

  // Guard against `lastInsertRowid` ever handing out our reserved-ish
  // sequence unexpectedly: chats start at 1 (assistant id 0 lives elsewhere).
  const createdAt = Math.floor(Date.now() / 1000);
  // A fresh chat's `last_message_at` is its creation time, so an empty chat
  // sorts to the top of the recency-ordered list.
  const result = db
    .prepare(
      "INSERT INTO chats (title, participants, from_chat_id, source, source_session, source_context, created_at, last_message_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      safeTitle,
      stringifyArray(unique),
      safeFrom,
      safeSource,
      safeSession,
      safeContext,
      createdAt,
      createdAt,
    );
  return getChat(Number(result.lastInsertRowid)) as Chat;
}

export function updateChatTitle(id: number, title: string): Chat | null {
  const safeTitle = title.trim();
  if (safeTitle.length > 200) throw new Error("Chat title is too long.");
  getDB().prepare("UPDATE chats SET title = ? WHERE id = ?").run(safeTitle, id);
  return getChat(id);
}

/**
 * Collect a chat id together with every chat spawned from it (transitively),
 * via a cycle-safe recursive CTE. `UNION` (not `UNION ALL`) dedupes rows so a
 * malformed self/circular `from_chat_id` chain still terminates. Returns `[]`
 * when the root chat does not exist.
 */
export function listChatTreeIds(rootId: number): number[] {
  const rows = getDB()
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM chats WHERE id = ?
         UNION
         SELECT c.id FROM chats c JOIN tree t ON c.from_chat_id = t.id
       )
       SELECT id FROM tree`,
    )
    .all(rootId) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

/**
 * Delete several chats atomically. Messages and session rows cascade via
 * foreign keys; callers are responsible for tearing down warm agent sessions
 * and cleaning up the corresponding disk session files.
 */
export function deleteChats(ids: number[]): number {
  const unique = [...new Set(ids)].filter(
    (id) => Number.isSafeInteger(id) && id > 0,
  );
  if (unique.length === 0) return 0;
  const db = getDB();
  const remove = db.prepare("DELETE FROM chats WHERE id = ?");
  return db.transaction(() => {
    let changes = 0;
    for (const id of unique) {
      changes += remove.run(id).changes;
    }
    return changes;
  })();
}

/**
 * Delete a chat. Messages and session rows cascade via foreign keys; callers
 * are responsible for cleaning up the corresponding disk session files.
 */
export function deleteChat(id: number): boolean {
  return deleteChats([id]) > 0;
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

function toChat(row: ChatRow): Chat {
  return {
    id: row.id,
    title: row.title ?? "",
    participants: parseNumberArray(row.participants),
    unread: row.unread ?? 0,
    createdAt: row.created_at,
    fromChatId: row.from_chat_id ?? null,
    source: normalizeSource(row.source),
  };
}

/** Coerce a stored `source` string to a known platform, else null. */
function normalizeSource(value: string | null): Chat["source"] {
  return value === "wechat" || value === "qq" || value === "telegram"
    ? value
    : null;
}

function toChatSummary(row: ChatSummaryRow): ChatSummary {
  return {
    ...toChat(row),
    preview: row.preview,
    lastAt: row.last_at,
    lastMessageAt: row.last_message_at,
  };
}

/** Cursor payload: `"<lastMessageAt>:<id>"` of the last row of the previous page. */
function encodeChatCursor(lastMessageAt: number, id: number): string {
  return `${lastMessageAt}:${id}`;
}

function decodeChatCursor(cursor: string): {
  lastMessageAt: number;
  id: number;
} | null {
  const split = cursor.lastIndexOf(":");
  if (split <= 0) return null;
  const lastMessageAt = Number(cursor.slice(0, split));
  const id = Number(cursor.slice(split + 1));
  if (!Number.isFinite(lastMessageAt) || !Number.isSafeInteger(id)) return null;
  return { lastMessageAt, id };
}
