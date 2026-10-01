import type { EmployeeSession } from "@shared/types";
import { rm } from "fs/promises";
import { resolve } from "path";
import { getAgentSessionsDir } from "../data-dir";
import { getDB } from "./index";

interface SessionRow {
  employee_id: number;
  chat_id: number;
  session: string;
}

export function getSession(
  employeeId: number,
  chatId: number,
): EmployeeSession | null {
  const row = getDB()
    .prepare("SELECT * FROM sessions WHERE employee_id = ? AND chat_id = ?")
    .get(employeeId, chatId) as SessionRow | undefined;
  return row ? toRecord(row) : null;
}

/** Persist (or replace) the Pi session path for an employee in a chat. */
export function setSession(
  employeeId: number,
  chatId: number,
  sessionPath: string,
): void {
  const db = getDB();
  if (!db.prepare("SELECT 1 FROM employees WHERE id = ?").get(employeeId)) {
    throw new Error("Employee does not exist.");
  }
  if (!db.prepare("SELECT 1 FROM chats WHERE id = ?").get(chatId)) {
    throw new Error("Chat does not exist.");
  }
  if (typeof sessionPath !== "string" || sessionPath.length === 0) {
    throw new Error("Session path must be a non-empty string.");
  }
  db.prepare(
    "INSERT INTO sessions (employee_id, chat_id, session) VALUES (?, ?, ?) " +
      "ON CONFLICT(employee_id, chat_id) DO UPDATE SET session = excluded.session",
  ).run(employeeId, chatId, sessionPath);
}

export function listByEmployee(employeeId: number): EmployeeSession[] {
  return (
    getDB()
      .prepare("SELECT * FROM sessions WHERE employee_id = ?")
      .all(employeeId) as SessionRow[]
  ).map(toRecord);
}

export function listByChat(chatId: number): EmployeeSession[] {
  return (
    getDB()
      .prepare("SELECT * FROM sessions WHERE chat_id = ?")
      .all(chatId) as SessionRow[]
  ).map(toRecord);
}

/** Unlink a recorded session file when (and only when) contained. */
export async function unlinkSessionFile(sessionPath: string): Promise<void> {
  try {
    if (!isInsideSessionsDir(sessionPath)) return;
    await rm(resolve(sessionPath), { force: true, recursive: true });
  } catch {
    // Unlink failures must not block DB deletion; the file is inert without
    // its row. Callers surface errors at a higher level if needed.
  }
}

export async function deleteSession(
  employeeId: number,
  chatId: number,
): Promise<boolean> {
  const existing = getSession(employeeId, chatId);
  if (!existing) return false;
  const removed =
    getDB()
      .prepare("DELETE FROM sessions WHERE employee_id = ? AND chat_id = ?")
      .run(employeeId, chatId).changes > 0;
  await unlinkSessionFile(existing.session);
  return removed;
}

/** Delete every session belonging to one employee (DB rows only here). */
export async function deleteForEmployee(employeeId: number): Promise<void> {
  getDB().prepare("DELETE FROM sessions WHERE employee_id = ?").run(employeeId);
}

/** Delete every session belonging to one chat (DB rows only here). */
export async function deleteForChat(chatId: number): Promise<void> {
  getDB().prepare("DELETE FROM sessions WHERE chat_id = ?").run(chatId);
}

function toRecord(row: SessionRow): EmployeeSession {
  return {
    employeeId: row.employee_id,
    chatId: row.chat_id,
    session: row.session,
  };
}

/**
 * Delete session row(s); the DB cascade handles rows when whole employees or
 * chats are removed, while this helper also unlinks recorded session files.
 *
 * Security: a stored path is only honored for unlinking when it resolves
 * strictly inside `~/.imboss/agent/sessions`. Anything else (stale, hand-edited,
 * or malicious rows) is dropped from the DB but never deleted from disk.
 */
function isInsideSessionsDir(filePath: string): boolean {
  const norm = (p: string): string =>
    process.platform === "win32" ? p.toLowerCase() : p;
  const root = norm(resolve(getAgentSessionsDir()));
  const target = norm(resolve(filePath));
  return (
    target === root ||
    target.startsWith(root + "/") ||
    target.startsWith(root + "\\")
  );
}
