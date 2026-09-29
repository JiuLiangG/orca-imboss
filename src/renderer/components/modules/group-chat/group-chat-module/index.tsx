import { t } from "@shared/l10n";
import type { Message } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import { GroupAvatar } from "../../../group-avatar";
import { MessageItem } from "../../chat/message-item";
import "../../chat/thread.css";

export interface GroupChatModuleProps {
  chatId: number;
}

/**
 * Read-only view of a group chat opened from a `chat`-kind card. Shows the
 * conversation history and live-updates on new messages; it never sends
 * (`ChatInputBar` is absent), never binds an agent session, and never touches
 * the unread cursor.
 */
export function GroupChatModule({
  chatId,
}: GroupChatModuleProps): React.JSX.Element {
  const { openedChats } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const chat = openedChats.find((c) => c.id === chatId) ?? null;

  const loadMessages = useCallback(async (id: number): Promise<void> => {
    try {
      setMessages(await imb.messages.list(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadMessages(chatId);
  }, [chatId, loadMessages]);

  // Live-append: refresh whenever this chat gains a message.
  useEffect(() => {
    const off = imb.messages.onChanged(({ chatId: changedId }) => {
      if (changedId !== chatId) return;
      void loadMessages(chatId);
    });
    return off;
  }, [chatId, loadMessages]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const content = (
    <>
      <div className="imb-chat-header">
        <div className="imb-chat-header-avatar">
          <GroupAvatar
            participants={chat?.participants ?? []}
            size={36}
            title={chat?.title}
          />
        </div>
        <div className="imb-chat-title">{chat?.title ?? t("Conversation")}</div>
      </div>
      <div className="imb-thread" ref={threadRef}>
        {messages.length === 0 ? (
          <div className="imb-chat-empty-detail">{t("No messages yet")}</div>
        ) : (
          messages.map((message) => (
            <MessageItem
              key={`${message.chatId}-${message.id}`}
              message={message}
              readonly
            />
          ))
        )}
      </div>
      {error !== null && (
        <p className="imb-error-text imb-chat-error">{error}</p>
      )}
    </>
  );

  return <ModuleView content={content} />;
}
