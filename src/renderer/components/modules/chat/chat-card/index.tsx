import { t } from "@shared/l10n";
import type { ChatSummary, Message } from "@shared/types";
import { useEffect, useState } from "react";
import { appStore } from "../../../../app-store";
import { EmployeeAvatar } from "../../../employee-avatar";
import { GroupAvatar } from "../../../group-avatar";
import "./index.css";

/** Resolved target-chat summaries, keyed by chat id (null = missing). */
const summaryCache = new Map<number, ChatSummary | null>();

export interface ChatCardProps {
  /** A `kind="chat"` message whose content is the linked chat's id. */
  message: Message;
}

/**
 * Link card for a `kind="chat"` message (posted by `imb_create_chat` into the
 * spawning chat). Shows the linked group's composite avatar + title; clicking
 * opens the group conversation as a Nav entry. A missing/invalid link renders
 * a disabled placeholder instead of navigation.
 */
export function ChatCard({ message }: ChatCardProps): React.JSX.Element {
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
        summaryCache.set(chatId, result);
        if (!ignore) setSummary(result);
      } catch {
        summaryCache.set(chatId, null);
        if (!ignore) setSummary(null);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [chatId]);

  return (
    <div className="imb-msg imb-other">
      <EmployeeAvatar employeeId={message.senderEmployeeId} size={34} />
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
