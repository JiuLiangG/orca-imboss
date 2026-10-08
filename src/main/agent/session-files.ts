import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { getAgentSessionsDir } from "../data-dir";
import * as dbChats from "../db/chats";
import * as dbSessions from "../db/sessions";
import { loadPiSdk } from "./pi-sdk";
import { resolveWorkDir } from "./workdir";

/**
 * Persistent per-`(employee, chat)` Pi session files.
 *
 * A session file is materialized deterministically at
 * `<sessionsDir>/chats/<chatId>/<employeeId>.jsonl` and recorded in the
 * `sessions` table so `AgentSession` resumes it instead of starting in-memory.
 * Shared by the built-in team tools (group chats) and the session queue
 * (every run, including the assistant's root chat).
 */

/** Path of a persistent per-(employee, chat) Pi session file. */
export function sessionPathFor(chatId: number, employeeId: number): string {
  return join(
    getAgentSessionsDir(),
    "chats",
    String(chatId),
    `${employeeId}.jsonl`,
  );
}

/**
 * Materialize an empty Pi session file at `path` so it can be resumed later.
 *
 * `SessionManager.open` on a zero-byte file immediately writes a valid session
 * header, which is exactly the deterministic file we want on disk from the
 * start. Best-effort: a materialization failure is logged and never thrown, so
 * a file problem can never roll back a committed DB transaction.
 */
export async function materializeSessionFile(path: string): Promise<void> {
  const pi = await loadPiSdk();
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(path, "", { flag: "wx" });
  } catch {
    // File already exists (valid or empty) — opening below handles it.
  }
  try {
    // Empty file => open writes a valid header; existing session => loads.
    pi.SessionManager.open(path, dir, resolveWorkDir());
  } catch (err) {
    console.error(
      `[session-files] Failed to materialize session ${path}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Ensure a session row (and its on-disk file) exists for (employee, chat).
 *
 * Idempotent: returns immediately when a row is already recorded. The row is
 * written even when the file materialization failed — a later resume re-opens
 * (and re-creates the header) from the empty file.
 */
export async function ensureSessionFile(
  employeeId: number,
  chatId: number,
): Promise<void> {
  if (dbSessions.getSession(employeeId, chatId)) return;
  // Guard: never materialize a session (and its directory) for a chat that no
  // longer exists. A racing cron tick after chat deletion would otherwise
  // re-create the orphan session files that `chats:delete` just removed.
  if (!dbChats.getChat(chatId)) {
    throw new Error("Chat does not exist.");
  }
  const path = sessionPathFor(chatId, employeeId);
  try {
    await materializeSessionFile(path);
  } catch (err) {
    console.error(
      `[session-files] Failed to materialize session for ${employeeId} in chat ${chatId}:`,
      err instanceof Error ? err.message : err,
    );
  }
  dbSessions.setSession(employeeId, chatId, path);
}
