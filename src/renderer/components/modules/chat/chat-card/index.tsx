import { t } from "@shared/l10n";
import type { ChatSummary, Message } from "@shared/types";
import { useEffect, useState } from "react";
import { appStore } from "../../../../app-store";
import { EmployeeAvatar } from "../../../employee-avatar";
import { GroupAvatar } from "../../../group-avatar";
import "./index.css";

/**
 * Resolved target-chat summaries, keyed by chat id. Only successful lookups are
 * cached: a missing chat (`null`) is never stored, so it cannot become a
 * permanent negative cache that later masks a chat created under a reused id.
 */
const summaryCache = new Map<number, ChatSummary>();

/**
 * One-time binding that drops shared cache entries for cascade-deleted chats,
 * so a later mount of a card for a deleted chat cannot reuse a stale summary.
 */
let summaryCacheCleanupBound = false;
function bindSummaryCacheCleanup(): void {
  if (summaryCacheCleanupBound) return;
  summaryCacheCleanupBound = true;
  imb.chats.onDeleted(({ chatIds }) => {
    if (!Array.isArray(chatIds)) return;
    for (const id of chatIds) summaryCache.delete(id);
  });
}

export interface ChatCardProps {
  /** A `kind="chat"` message whose content is the linked chat's id. */
  message: Message;
  /** Click handler for the sender avatar (opens the agent session). */
  onAvatarClick?: () => void;
}

/**
 * Link card for a `kind="chat"` message (posted by `imb_create_chat` into the
 * spawning chat). Shows the linked group's composite avatar + title; clicking
 * opens the group conversation as a Nav entry. A missing/invalid link renders
 * a disabled placeholder instead of navigation.
 */
export function ChatCard({
  message,
  onAvatarClick,
}: ChatCardProps): React.JSX.Element {
  const chatId = parseChatId(message.content);
  const [summary, setSummary] = useState<ChatSummary | null | undefined>(() =>
    chatId === null ? null : summaryCache.get(chatId),
  );

  useEffect(() => {
    if (chatId === null) return;
    const cached = summaryCache.get(chatId);
    if (cached !== undefined) {
      setSummary(cached);
      return;
    }
    // Canonical React async-effect pattern: a synchronous callback plus an
    // `ignore` flag so a stale response never updates an unmounted component.
    let ignore = false;
    void (async () => {
      try {
        const result = await imb.chats.summary(chatId);
        // Cache only successful lookups. A missing chat must be re-checked on
        // the next mount instead of staying a permanent negative entry that a
        // reused id would inherit.
        if (result !== null) summaryCache.set(chatId, result);
        if (!ignore) setSummary(result);
      } catch {
        if (!ignore) setSummary(null);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [chatId]);

  // A cascade delete removes the linked group chat; disable the card and drop
  // the shared cache entry when that happens.
  useEffect(() => {
    bindSummaryCacheCleanup();
    if (chatId === null) return;
    const off = imb.chats.onDeleted(({ chatIds }) => {
      if (Array.isArray(chatIds) && chatIds.includes(chatId)) {
        summaryCache.delete(chatId);
        setSummary(null);
      }
    });
    return off;
  }, [chatId]);

  return (
    <div className="imb-msg imb-other">
      <EmployeeAvatar
        employeeId={message.senderEmployeeId}
        size={34}
        onClick={onAvatarClick}
      />
      {summary ? (
        <button
          type="button"
          className="imb-chat-card"
          onClick={() => appStore.openChat(summary)}
        >
          <GroupAvatar
            participants={summary.participants}
            size={40}
            title={summary.title}
          />
          <span className="imb-chat-card-title">{summary.title}</span>
        </button>
      ) : (
        <div className="imb-chat-card imb-is-disabled" aria-disabled="true">
          <span className="imb-chat-card-placeholder" aria-hidden="true">
            ?
          </span>
          <span className="imb-chat-card-title">
            {summary === undefined
              ? t("Loading…")
              : t("Conversation unavailable")}
          </span>
        </div>
      )}
    </div>
  );
}

/** Defensive parse of the message content (the linked chat id). */
function parseChatId(content: string): number | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) return null;
  const id = Number(trimmed);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
