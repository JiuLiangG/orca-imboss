import type {
  Chat,
  ChatParticipantUpdate,
  ChatSummary,
} from "../../../shared/types";
import { getDB } from "../index";
import { parseNumberArray, stringifyArray } from "./json";

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
