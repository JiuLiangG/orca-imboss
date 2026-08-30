import type {
  AppendMessageOptions,
  Message,
  MessageAttachment,
  MessageKind,
  MessageSearchResult,
  MessageStep,
  StepStatus,
} from "../../../shared/types";
import { getDB } from "../index";
import { bumpUnread } from "./chats";
import { parseJsonObject } from "./json";
import { escapeLike, toFtsPhrase } from "./text-search";

interface MessageRow {
  id: number;
  chat_id: number;
  sender_employee_id: number | null;
  kind: string;
  content: string;
  steps: string | null;
  attachments: string | null;
  created_at: number;
}

const MAX_CONTENT_LENGTH = 100_000;
const MAX_STEPS = 64;
const MAX_ATTACHMENTS = 16;
const MAX_STEP_NAME_LENGTH = 256;
const MAX_STEP_ROLE_LENGTH = 256;
const MAX_ATTACH_NAME_LENGTH = 256;
const MAX_ATTACH_TYPE_LENGTH = 128;
const MAX_ATTACH_SIZE = 50 * 1024 * 1024; // metadata only; previews capped below
const MAX_PREVIEW_LENGTH = 2_000_000; // ~2 MB string, keeps DB sane
const STEP_STATUSES: StepStatus[] = ["done", "busy"];

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    chatId: row.chat_id,
    senderEmployeeId: row.sender_employee_id,
    kind: row.kind === "task_progress" ? "task_progress" : "text",
    content: row.content,
    steps: parseSteps(row.steps),
    attachments: parseAttachments(row.attachments),
    createdAt: row.created_at,
  };
}

function parseSteps(raw: string | null): MessageStep[] | null {
  if (!raw) return null;
  const parsed = parseJsonObject(raw);
  const steps = parsed["steps"];
  if (!Array.isArray(steps)) return null;
  const result: MessageStep[] = [];
  for (const step of steps) {
    if (typeof step !== "object" || step === null) continue;
    const record = step as Record<string, unknown>;
    if (
      typeof record["name"] !== "string" ||
      typeof record["role"] !== "string" ||
      (record["status"] !== "done" && record["status"] !== "busy")
    ) {
      continue;
    }
    result.push({
      name: record["name"],
      role: record["role"],
      status: record["status"],
    });
  }
  return result;
}

/**
 * Parse a stored attachments JSON. Stored values are never trusted: entries
 * are validated field by field and invalid ones dropped; `null` is stored as
 * null and only ever surfaces as `[]` when the column held a valid array.
 */
function parseAttachments(raw: string | null): MessageAttachment[] | null {
  if (!raw) return null;
  const parsed = parseJsonObject(raw);
  const list = parsed["attachments"];
  if (!Array.isArray(list)) return null;
  const result: MessageAttachment[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record["name"] !== "string" || record["name"].length === 0) {
      continue;
    }
    result.push({
      name: record["name"],
      size: typeof record["size"] === "number" ? record["size"] : 0,
      type: typeof record["type"] === "string" ? record["type"] : "",
      preview:
        typeof record["preview"] === "string" && record["preview"].length > 0
          ? record["preview"]
          : null,
    });
  }
  return result;
}

function validateSteps(
  steps: MessageStep[] | undefined,
): MessageStep[] | undefined {
  if (steps === undefined) return undefined;
  if (!Array.isArray(steps)) throw new Error("steps must be an array.");
  if (steps.length > MAX_STEPS) throw new Error("Too many progress steps.");
  const result: MessageStep[] = [];
  for (const step of steps) {
    if (typeof step !== "object" || step === null) {
      throw new Error("Invalid progress step.");
    }
    const name = String(step.name ?? "");
    const role = String(step.role ?? "");
    if (name.length === 0 || name.length > MAX_STEP_NAME_LENGTH) {
      throw new Error("Progress step name has invalid length.");
    }
    if (role.length > MAX_STEP_ROLE_LENGTH) {
      throw new Error("Progress step role is too long.");
    }
    if (!STEP_STATUSES.includes(step.status)) {
      throw new Error("Progress step status must be done or busy.");
    }
    result.push({ name, role, status: step.status });
  }
  return result;
}

function validateAttachments(
  attachments: MessageAttachment[] | undefined,
): MessageAttachment[] | undefined {
  if (attachments === undefined) return undefined;
  if (!Array.isArray(attachments)) {
    throw new Error("attachments must be an array.");
  }
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new Error("Too many attachments.");
  }
  const result: MessageAttachment[] = [];
  for (const item of attachments) {
    if (typeof item !== "object" || item === null) {
      throw new Error("Invalid attachment.");
    }
    const name = String(item.name ?? "");
    if (name.length === 0 || name.length > MAX_ATTACH_NAME_LENGTH) {
      throw new Error("Attachment name has invalid length.");
    }
    if (
      typeof item.size !== "number" ||
      !Number.isFinite(item.size) ||
      item.size < 0 ||
      item.size > MAX_ATTACH_SIZE
    ) {
      throw new Error("Attachment size is out of range.");
    }
    const type = String(item.type ?? "");
    if (type.length > MAX_ATTACH_TYPE_LENGTH) {
      throw new Error("Attachment type is too long.");
    }
    const preview =
      typeof item.preview === "string" && item.preview.length > 0
        ? item.preview
        : null;
    if (preview !== null && preview.length > MAX_PREVIEW_LENGTH) {
      throw new Error("Attachment preview is too large.");
    }
    result.push({ name, size: item.size, type, preview });
  }
  return result;
}

/** List a chat's messages in conversation order (`created_at` ascending; `id` breaks same-second ties). */
export function listMessages(chatId: number): Message[] {
  return (
    getDB()
      .prepare(
        "SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC",
      )
      .all(chatId) as MessageRow[]
  ).map(toMessage);
}

/**
 * Append one message at the end of the chat. The row id is global and
 * monotonically increasing, so per-chat conversation order is simply
 * `created_at ASC, id ASC` (id breaks same-second ties); writes are already
 * serialized on the main-process event loop (synchronous driver).
 *
 * Messages from employees (sender_employee_id != NULL) also bump the chat's
 * unread counter; opening a chat clears it via `chats:markRead`.
 */
export function appendMessage(
  chatId: number,
  senderEmployeeId: number | null,
  content: string,
  options: AppendMessageOptions = {},
): Message {
  const db = getDB();
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("Message content must be a non-empty string.");
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error("Message is too long.");
  }
  if (!db.prepare("SELECT 1 FROM chats WHERE id = ?").get(chatId)) {
    throw new Error("Chat does not exist.");
  }
  if (
    senderEmployeeId != null &&
    !db.prepare("SELECT 1 FROM employees WHERE id = ?").get(senderEmployeeId)
  ) {
    throw new Error("Sender employee does not exist.");
  }

  const kind: MessageKind =
    options.kind === "task_progress" ? "task_progress" : "text";
  const steps = validateSteps(options.steps);
  if (kind === "task_progress" && steps !== undefined && steps.length === 0) {
    throw new Error("Progress messages need at least one step.");
  }
  const attachments = validateAttachments(options.attachments);

  const createdAt = Math.floor(Date.now() / 1000);
  const result = db
    .prepare(
      "INSERT INTO messages (chat_id, sender_employee_id, kind, content, steps, attachments, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      chatId,
      senderEmployeeId,
      kind,
      content,
      steps !== undefined ? JSON.stringify({ steps }) : null,
      attachments !== undefined ? JSON.stringify({ attachments }) : null,
      createdAt,
    );

  // Unread bump lives here (single append write path): assistant/employee
  // messages mark the chat as unread; user messages do not.
  if (senderEmployeeId != null) {
    bumpUnread(chatId);
  }
  return toMessage({
    id: Number(result.lastInsertRowid),
    chat_id: chatId,
    sender_employee_id: senderEmployeeId,
    kind,
    content,
    steps: steps !== undefined ? JSON.stringify({ steps }) : null,
    attachments:
      attachments !== undefined ? JSON.stringify({ attachments }) : null,
    created_at: createdAt,
  });
}

const MAX_SEARCH_QUERY_LENGTH = 200;
const MAX_SEARCH_RESULTS = 50;

/** Wrap the first (case-insensitive) match in the same markers FTS uses. */
function likeSnippet(content: string, needle: string): string {
  const lower = content.toLowerCase();
  const at = lower.indexOf(needle.toLowerCase());
  if (at < 0) {
    return content.length > 80 ? `${content.slice(0, 80)}…` : content;
  }
  const start = Math.max(0, at - 24);
  const end = Math.min(content.length, at + needle.length + 40);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return `${prefix}${content.slice(start, at)}«${content.slice(at, at + needle.length)}»${content.slice(at + needle.length, end)}${suffix}`;
}

/**
 * Search messages by content. Queries of 3+ characters use the FTS5 trigram
 * index (ranked, highlighted snippet); shorter queries fall back to a LIKE
 * substring scan so Chinese 1-2 char queries still work. Returns up to
 * `MAX_SEARCH_RESULTS` matches, newest first in the LIKE path.
 */
export function searchMessages(query: string): MessageSearchResult[] {
  const needle = query.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
  if (needle.length === 0) return [];

  const db = getDB();
  if (needle.length < 3) {
    const pattern = `%${escapeLike(needle)}%`;
    const rows = db
      .prepare(
        `SELECT m.chat_id AS chatId, m.id AS messageId, m.created_at AS createdAt,
                m.content AS content, c.title AS chatTitle
         FROM messages m JOIN chats c ON c.id = m.chat_id
         WHERE m.content LIKE ? ESCAPE '\\'
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT ?`,
      )
      .all(pattern, MAX_SEARCH_RESULTS) as Array<{
      chatId: number;
      messageId: number;
      createdAt: number;
      content: string;
      chatTitle: string;
    }>;
    return rows.map((row) => ({
      chatId: row.chatId,
      messageId: row.messageId,
      chatTitle: row.chatTitle,
      snippet: likeSnippet(row.content, needle),
      createdAt: row.createdAt,
    }));
  }

  // Treat user input as a literal phrase: quote it and escape inner quotes.
  const phrase = toFtsPhrase(needle);
  const rows = db
    .prepare(
      `SELECT m.chat_id AS chatId, m.id AS messageId, m.created_at AS createdAt,
              c.title AS chatTitle,
              snippet(messages_fts, 0, '«', '»', '…', 24) AS snippet
       FROM messages_fts
       JOIN messages m ON m.id = messages_fts.rowid
       JOIN chats c ON c.id = m.chat_id
       WHERE messages_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(phrase, MAX_SEARCH_RESULTS) as MessageSearchResult[];
  return rows;
}
