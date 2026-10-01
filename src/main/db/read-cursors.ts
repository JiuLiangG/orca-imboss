import { getDB } from "./index";

/**
 * Per-`(employee, chat)` read cursor for `imb_read_chat`.
 *
 * Deliberately independent of the `sessions` table: the assistant reads task
 * group chats from its root-chat session, so it needs a cursor in chats where
 * it has no agent session of its own.
 */

/** Read the cursor (0 when nothing has been read yet). */
export function getReadCursor(employeeId: number, chatId: number): number {
  const row = getDB()
    .prepare(
      "SELECT last_read_message_id FROM read_cursors WHERE employee_id = ? AND chat_id = ?",
    )
    .get(employeeId, chatId) as { last_read_message_id: number } | undefined;
  return row?.last_read_message_id ?? 0;
}

/**
 * Advance the cursor. Upserts, so a reader without an agent session in the chat
 * (the assistant reading a task group chat) still persists its position.
 */
export function setReadCursor(
  employeeId: number,
  chatId: number,
  messageId: number,
): void {
  getDB()
    .prepare(
      "INSERT INTO read_cursors (employee_id, chat_id, last_read_message_id) " +
        "VALUES (?, ?, ?) " +
        "ON CONFLICT(employee_id, chat_id) DO UPDATE SET " +
        "last_read_message_id = excluded.last_read_message_id",
    )
    .run(employeeId, chatId, messageId);
}
