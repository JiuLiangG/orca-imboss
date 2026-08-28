import { useCallback, useEffect, useRef, useState } from "react";
import { getLocale, t } from "../../../../../../shared/libs/l10n";
import type {
  ChatSummary,
  Message,
  MessageAttachment,
} from "../../../../../../shared/types";
import { ModuleView } from "../../../app-shell";
import { Avatar } from "../../../avatar";
import { Button } from "../../../button";
import { ContextMenu, type ContextMenuState } from "../../../context-menu";
import { EmptyState } from "../../../empty-state";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { Modal } from "../../../modal";
import { SearchInput } from "../../../search-input";
import { ChatInputBar } from "../chat-input-bar";
import { AssistantMark, MessageBubble } from "../message-bubble";
import { ProgressCard } from "../progress-card";
import { formatChatTime, previewText } from "../relative-time";
import "./index.css";

/** Chat module: list + thread + composer (placeholder pipeline). */
export function ChatModule(): React.JSX.Element {
  const [summaries, setSummaries] = useState<ChatSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [selectedChats, setSelectedChats] = useState<Set<number>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;
  const locale = getLocale();

  const refreshSummaries = useCallback(async (): Promise<void> => {
    try {
      const data = await window.imb.chats.summaries();
      setSummaries(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadMessages = useCallback(async (chatId: number): Promise<void> => {
    try {
      const data = await window.imb.messages.list(chatId);
      setMessages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const selectChat = useCallback(
    async (chatId: number): Promise<void> => {
      setSelectedId(chatId);
      void loadMessages(chatId);
      void window.imb.chats.markRead(chatId);
      // Local unread clear keeps the list instant; summaries refresh below.
      setSummaries((current) =>
        current.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)),
      );
      setSelectedChats(new Set());
    },
    [loadMessages],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await window.imb.chats.summaries();
        if (!alive) return;
        setSummaries(data);
        if (data.length > 0) {
          const first = data[0];
          setSelectedId(first.id);
          void loadMessages(first.id);
          void window.imb.chats.markRead(first.id);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    const offMessages = window.imb.messages.onChanged((chatId) => {
      void refreshSummaries();
      if (chatId === selectedIdRef.current) {
        // The user is viewing this chat: replies clear unread immediately.
        void window.imb.chats.markRead(chatId);
        setSummaries((current) =>
          current.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)),
        );
        void loadMessages(chatId);
      }
    });
    return () => {
      alive = false;
      offMessages();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom when messages change.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(
    async (text: string, attachments: MessageAttachment[]): Promise<void> => {
      if (selectedId === null) return;
      try {
        await window.imb.chat.send(selectedId, text, attachments);
        await Promise.all([loadMessages(selectedId), refreshSummaries()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [selectedId, loadMessages, refreshSummaries],
  );

  const newChat = useCallback(async (): Promise<void> => {
    try {
      const chat = await window.imb.chats.create(t("New chat"), []);
      await window.imb.messages.append(
        chat.id,
        0,
        t("Hello, I'm your assistant. Tell me what you need."),
      );
      await refreshSummaries();
      await selectChat(chat.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshSummaries, selectChat]);

  const deleteSelected = useCallback(async (): Promise<void> => {
    if (selectedChats.size === 0) return;
    try {
      const ids = [...selectedChats];
      for (const id of ids) {
        await window.imb.chats.remove(id);
      }
      setSelectedChats(new Set());
      setDeleteOpen(false);
      const data = await window.imb.chats.summaries();
      setSummaries(data);
      if (data.length > 0) {
        if (selectedId === null || ids.includes(selectedId)) {
          await selectChat(data[0].id);
        }
      } else {
        setSelectedId(null);
        setMessages([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedChats, selectedId, selectChat]);

  const toggleSelectAll = useCallback((): void => {
    setSelectedChats((current) => {
      if (current.size === summaries.length) return new Set();
      return new Set(summaries.map((s) => s.id));
    });
  }, [summaries]);

  const filtered = summaries.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.title.toLowerCase().includes(q) ||
      (c.preview ?? "").toLowerCase().includes(q)
    );
  });

  const selected = summaries.find((s) => s.id === selectedId) ?? null;

  const list = (
    <ListPane
      title={t("Conversations")}
      search={
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("Filter chat titles")}
        />
      }
      footer={
        <Button
          block
          icon={<span aria-hidden="true">＋</span>}
          onClick={() => void newChat()}
        >
          {t("New chat")}
        </Button>
      }
    >
      {loading ? (
        <EmptyState>{t("Loading…")}</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>{t("No matching chats")}</EmptyState>
      ) : (
        filtered.map((chat) => (
          <ListRow
            key={chat.id}
            active={chat.id === selectedId}
            selected={selectedChats.has(chat.id)}
            avatar={
              <Avatar letter={chat.title.slice(0, 1)} name={chat.title} />
            }
            name={chat.title}
            meta={formatChatTime(chat.lastAt, locale)}
            sub={previewText(chat.preview ?? "")}
            badge={
              chat.unread > 0 ? (
                <span className="imb-unread">
                  {chat.unread > 99 ? "99+" : chat.unread}
                </span>
              ) : undefined
            }
            onClick={() => void selectChat(chat.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  {
                    key: "select-all",
                    label: t("Select all"),
                    onSelect: toggleSelectAll,
                  },
                  {
                    key: "delete",
                    label: t("Delete"),
                    danger: true,
                    onSelect: () => {
                      if (selectedChats.size === 0) {
                        setSelectedChats(new Set(summaries.map((s) => s.id)));
                      }
                      setDeleteOpen(true);
                    },
                  },
                ],
              });
            }}
          />
        ))
      )}
    </ListPane>
  );

  const detail = selected ? (
    <>
      <div className="imb-chat-header">
        <div className="imb-chat-header-avatar">
          <AssistantMark size={36} />
        </div>
        <div className="imb-chat-title">{selected.title}</div>
      </div>
      <div className="imb-thread" ref={threadRef}>
        {messages.map((message) =>
          message.kind === "task_progress" ? (
            <div
              className="imb-msg imb-other"
              key={`${message.chatId}-${message.id}`}
            >
              <span className="imb-avatar">
                <AssistantMark size={34} />
              </span>
              <ProgressCard
                title={message.content}
                steps={message.steps ?? []}
              />
            </div>
          ) : (
            <MessageBubble
              key={`${message.chatId}-${message.id}`}
              self={message.senderEmployeeId === null}
              content={message.content}
              attachments={message.attachments}
              avatar={
                message.senderEmployeeId === null ? (
                  <UserMark />
                ) : (
                  <AssistantMark size={34} />
                )
              }
            />
          ),
        )}
      </div>
      <ChatInputBar
        onSend={(text, attachments) => void handleSend(text, attachments)}
      />
    </>
  ) : (
    <div className="imb-detail-scroll">
      <div className="imb-chat-empty-detail">
        {t(
          'No conversations yet. Click "New chat" in the bottom-left to start.',
        )}
      </div>
    </div>
  );

  return (
    <>
      <ModuleView list={list} detail={detail} />
      <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("Delete chats")}
        sub={t(
          "Are you sure you want to delete the selected ${count} conversations? This cannot be undone.",
          { count: String(selectedChats.size) },
        )}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button variant="danger" onClick={() => void deleteSelected()}>
              {t("Delete")}
            </Button>
          </>
        }
      >
        <p className="imb-chat-delete-note">
          {t(
            "The conversations and their messages will be permanently removed.",
          )}
        </p>
      </Modal>
      {error !== null && (
        <p className="imb-error-text imb-chat-error">{error}</p>
      )}
    </>
  );
}

/** User avatar mark (prototype `userAvatar` svg). */
function UserMark(): React.JSX.Element {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="18" fill="#1A1A1A" />
      <path
        d="M12 24 L14 16 L18 20 L22 16 L24 24 L24 26 L12 26 Z"
        fill="white"
        stroke="white"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
