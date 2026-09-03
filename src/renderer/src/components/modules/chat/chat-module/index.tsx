import { useCallback, useEffect, useRef, useState } from "react";
import { appStore, useApp } from "../../../../app-store";
import { getLocale, t } from "../../../../../../shared/libs/l10n";
import type {
  ChatSummary,
  Message,
  MessageAttachment,
  PageQuery,
  PageResult,
} from "../../../../../../shared/types";
import { useInfiniteList } from "../../../../hooks/use-infinite-list";
import { useMultiSelect } from "../../../../hooks/use-multi-select";
import { ModuleView } from "../../../app-shell";
import { Avatar } from "../../../avatar";
import { Button } from "../../../button";
import { ContextMenu, type ContextMenuState } from "../../../context-menu";
import { ItemList } from "../../../item-list";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { Modal } from "../../../modal";
import { SearchInput } from "../../../search-input";
import { ChatInputBar } from "../chat-input-bar";
import { AssistantMark, MessageBubble, UserMark } from "../message-bubble";
import { AskCard } from "../ask-card";
import { AnswerCard } from "../answer-card";
import { ProgressCard } from "../progress-card";
import { playNotificationSound } from "../../../../utils/sound";
import { formatChatTime, previewText } from "../relative-time";
import "./index.css";

const PAGE_SIZE = 50;

/** Chat module: list + thread + composer (placeholder pipeline). */
export function ChatModule(): React.JSX.Element {
  const { data, focusChatId } = useApp();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState("");
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;
  const locale = getLocale();
  const unreadMap = data.chats.unread;

  // Server-side search (title OR message content — FTS/LIKE handled in main).
  const fetchPage = useCallback(
    (page: PageQuery): Promise<PageResult<ChatSummary>> =>
      window.imb.chats.summariesPage(page),
    [],
  );
  const {
    items: chats,
    loading: listLoading,
    loadingMore: listLoadingMore,
    hasMore: listHasMore,
    error: listError,
    loadMore,
    reset,
    mutate,
    resetVersion,
  } = useInfiniteList(fetchPage, { query, pageSize: PAGE_SIZE });

  const loadMessages = useCallback(async (chatId: number): Promise<void> => {
    try {
      const data = await window.imb.messages.list(chatId);
      setMessages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Plain click / auto-select target: the rest (thread, unread) is an effect
  // on `selectedId` so every selection path stays consistent.
  const selectChat = useCallback((chatId: number): void => {
    setSelectedId(chatId);
  }, []);

  const multi = useMultiSelect<ChatSummary, number>({
    getKey: (chat) => chat.id,
    items: chats,
    onActivate: (chat) => selectChat(chat.id),
    resetVersion,
  });

  // Open thread + clear unread whenever the selection changes.
  useEffect(() => {
    if (selectedId === null) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedId);
    void window.imb.chats.markRead(selectedId);
    mutate((current) =>
      current.map((chat) =>
        chat.id === selectedId ? { ...chat, unread: 0 } : chat,
      ),
    );
  }, [selectedId, loadMessages, mutate]);

  // Auto-select the first chat after page 1 loads (and recover when the
  // selected chat disappears, e.g. bulk delete).
  useEffect(() => {
    if (listLoading) return;
    if (chats.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) =>
      current !== null && chats.some((chat) => chat.id === current)
        ? current
        : chats[0].id,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, listLoading]);

  // Jump to a focused chat (an OS notification click) once it is loaded.
  useEffect(() => {
    if (focusChatId === null) return;
    if (!chats.some((chat) => chat.id === focusChatId)) return;
    selectChat(focusChatId);
    appStore.focusChatId = null;
  }, [focusChatId, chats, selectChat]);

  useEffect(() => {
    const offMessages = window.imb.messages.onChanged((chatId) => {
      // Only the currently-open chat refreshes its thread (and beeps).
      if (chatId !== selectedIdRef.current) return;
      void window.imb.chats.markRead(chatId);
      void loadMessages(chatId);
      playNotificationSound();
    });
    return offMessages;
  }, [loadMessages]);

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
        void loadMessages(selectedId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [selectedId, loadMessages],
  );

  const newChat = useCallback(async (): Promise<void> => {
    try {
      const chat = await window.imb.chats.create(t("New Chat"), []);
      await window.imb.messages.append(
        chat.id,
        0,
        t("Hello, I'm your assistant. Tell me what you need."),
      );
      // The new chat is the newest row → page 1 top → auto-selected.
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [reset]);
  const deleteSelected = useCallback(async (): Promise<void> => {
    const ids = [...multi.selectedKeys];
    if (ids.length === 0) return;
    try {
      setDeleteOpen(false);
      for (const id of ids) {
        await window.imb.chats.remove(id);
      }
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [multi.selectedKeys, reset]);

  const toggleSelectAll = useCallback((): void => {
    if (multi.selectedKeys.size === chats.length && chats.length > 0) {
      multi.clear();
    } else {
      multi.selectAll();
    }
  }, [multi, chats.length]);

  const selected = chats.find((chat) => chat.id === selectedId) ?? null;

  const listPane = (
    <ListPane
      title={t("Chats")}
      search={
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("Search chats")}
        />
      }
      footer={
        <Button block onClick={() => void newChat()}>
          {t("New Chat")}
        </Button>
      }
    >
      <ItemList
        items={chats}
        getItemKey={(chat) => chat.id}
        loading={listLoading}
        loadingMore={listLoadingMore}
        hasMore={listHasMore}
        loadMore={() => void loadMore()}
        loadError={listError}
        selectable
        selectedKeys={multi.selectedKeys}
        onItemClick={(chat, index, mods) =>
          multi.onItemClick(chat, index, mods)
        }
        renderItem={(chat, { selected: isSelectedRow }) => (
          <ListRow
            active={chat.id === selectedId}
            selected={isSelectedRow}
            avatar={
              <Avatar letter={chat.title.slice(0, 1)} name={chat.title} />
            }
            name={chat.title}
            meta={formatChatTime(chat.lastAt, locale)}
            sub={previewText(chat.preview ?? "")}
            badge={(() => {
              const unread = unreadMap[chat.id] ?? chat.unread;
              return unread > 0 ? (
                <span className="imb-unread">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : undefined;
            })()}
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
                      if (multi.selectedKeys.size === 0) multi.selectAll();
                      setDeleteOpen(true);
                    },
                  },
                ],
              });
            }}
          />
        )}
      />
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
          message.kind === "ask" ? (
            <AskCard
              key={`${message.chatId}-${message.id}`}
              message={message}
              onAnswered={() => void loadMessages(message.chatId)}
            />
          ) : message.kind === "answer" ? (
            <AnswerCard
              key={`${message.chatId}-${message.id}`}
              message={message}
            />
          ) : message.kind === "task_progress" ? (
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
  ) : null;

  return (
    <>
      <ModuleView list={listPane} detail={detail} />
      <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("Delete chats")}
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
