import type { IntegrationPlatform } from "@shared/types";
import { getDB } from "./index";

const PLATFORMS: readonly IntegrationPlatform[] = ["wechat", "qq", "telegram"];

function isPlatform(value: unknown): value is IntegrationPlatform {
  return (
    typeof value === "string" &&
    (PLATFORMS as readonly string[]).includes(value)
  );
}

/** Platform binding of one chat (see the `chats.source*` columns). */
export interface ChatSource {
  chatId: number;
  platform: IntegrationPlatform;
  /** Platform conversation id (stable per platform). */
  session: string;
  /** Per-conversation reply credential (e.g. iLink `context_token`). */
  context: string | null;
}

/** Chat id bridged to a `(platform, session)` conversation, or null. */
export function findChatBySession(
  platform: IntegrationPlatform,
  session: string,
): number | null {
  if (!isPlatform(platform) || session.length === 0) return null;
  const row = getDB()
    .prepare(
      "SELECT id FROM chats WHERE source = ? AND source_session = ? LIMIT 1",
    )
    .get(platform, session) as { id: number } | undefined;
  return row?.id ?? null;
}

/** Platform binding of a chat, or null when the chat is local-only. */
export function getChatSource(chatId: number): ChatSource | null {
  const row = getDB()
    .prepare(
      "SELECT id, source, source_session, source_context FROM chats WHERE id = ?",
    )
    .get(chatId) as
    | {
        id: number;
        source: string | null;
        source_session: string | null;
        source_context: string | null;
      }
    | undefined;
  if (!row || !isPlatform(row.source) || !row.source_session) return null;
  return {
    chatId: row.id,
    platform: row.source,
    session: row.source_session,
    context: row.source_context ?? null,
  };
}

/** Attach (or replace) a chat's platform binding. */
export function setChatSource(
  chatId: number,
  platform: IntegrationPlatform,
  session: string,
  context: string | null,
): void {
  if (!isPlatform(platform) || session.length === 0) return;
  getDB()
    .prepare(
      "UPDATE chats SET source = ?, source_session = ?, source_context = ? WHERE id = ?",
    )
    .run(platform, session, context, chatId);
}

/**
 * Refresh the stored per-conversation reply credential. `context === null`
 * clears it; an empty string is ignored (never overwrite a good token with a
 * missing one).
 */
export function updateSessionContext(
  chatId: number,
  context: string | null,
): void {
  if (context === null) {
    getDB()
      .prepare("UPDATE chats SET source_context = NULL WHERE id = ?")
      .run(chatId);
    return;
  }
  if (context.length === 0) return;
  getDB()
    .prepare("UPDATE chats SET source_context = ? WHERE id = ?")
    .run(context, chatId);
}
