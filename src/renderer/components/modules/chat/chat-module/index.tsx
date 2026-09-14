import { getLocale, t } from "@shared/l10n";
import type {
  ChatSummary,
  Message,
  MessageAttachment,
  PageQuery,
  PageResult,
} from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { appStore, useApp } from "../../../../app-store";
import { useInfiniteList } from "../../../../hooks/use-infinite-list";
import { useMultiSelect } from "../../../../hooks/use-multi-select";
import { playNotificationSound } from "../../../../sound";
import { ModuleView } from "../../../app-shell";
import { Avatar } from "../../../avatar";
import { Button } from "../../../button";
import { ContextMenu, type ContextMenuState } from "../../../context-menu";
import { EmployeeAvatar } from "../../../employee-avatar";
import { ItemList } from "../../../item-list";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { Modal } from "../../../modal";
import { SearchInput } from "../../../search-input";
import { AnswerCard } from "../answer-card";
import { AskCard } from "../ask-card";
import { ChatInputBar } from "../chat-input-bar";
import { MessageBubble } from "../message-bubble";
import { ProgressCard } from "../progress-card";
import { formatChatTime, previewText } from "../relative-time";
import "./index.css";

const PAGE_SIZE = 50;

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

  // Hybrid search: an empty query reads the appStore chat cache (root-only,
  // recency-ordered); a non-empty query switches to a server-paged FTS/LIKE
  // search. `useInfiniteList` is always mounted but short-circuits to an empty
  // page when there is no query so it never shadows the cache.
  const isSearching = query.trim().length > 0;
  const fetchPage = useCallback(
    (page: PageQuery): Promise<PageResult<ChatSummary>> => {
      if (!isSearching) {
        return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
      }
      return imb.chats.summariesPage(page);
    },
    [isSearching],
  );
  const search = useInfiniteList(fetchPage, { query, pageSize: PAGE_SIZE });

  const chats = isSearching
    ? search.items
    : (data.chats.items as ChatSummary[]);
  const listLoading = isSearching ? search.loading : data.chats.loading;
  const listError = isSearching ? search.error : data.chats.error;
  const listHasMore = isSearching ? search.hasMore : false;
  const listLoadingMore = isSearching ? search.loadingMore : false;

  // Lazy-load the chat cache on first visit.
  useEffect(() => {
    appStore.ensureChats();
  }, []);

  const loadMessages = useCallback(async (chatId: number): Promise<void> => {
    try {
      const data = await imb.messages.list(chatId);
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
  });
  const clearSelection = multi.clear;

  // Switching between browse/search (query change) clears the selection.
  useEffect(() => {
    clearSelection();
  }, [clearSelection, query]);

  // Open thread + clear unread whenever the selection changes.
  useEffect(() => {
    if (selectedId === null) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedId);
    void imb.chats.markRead(selectedId);
    appStore.setChatUnread(selectedId, 0);
  }, [selectedId, loadMessages]);

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
    const offMessages = imb.messages.onChanged(
      ({ chatId, senderEmployeeId }) => {
        // Only the currently-open chat refreshes its thread (and beeps — but
        // not on the user's own message, where senderEmployeeId is null).
        if (chatId !== selectedIdRef.current) return;
        void imb.chats.markRead(chatId);
        void loadMessages(chatId);
        if (senderEmployeeId !== null) playNotificationSound();
      },
    );
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
        await imb.chat.send(selectedId, text, attachments);
        void loadMessages(selectedId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [selectedId, loadMessages],
  );

  const newChat = useCallback(async (): Promise<void> => {
    try {
      const chat = await imb.chats.create(t("New Chat"), []);
      // The new chat sorts to the top (last_message_at = creation time). The
      // auto-select effect only recovers a *missing* selection, so select the
      // new chat explicitly and clear any stale multi-selection.
      await appStore.reloadChats();
      clearSelection();
      setSelectedId(chat.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [clearSelection]);

  const deleteSelected = useCallback(async (): Promise<void> => {
    const ids = [...multi.selectedKeys];
    if (ids.length === 0) return;
    try {
      setDeleteOpen(false);
      for (const id of ids) {
        await imb.chats.remove(id);
      }
      await appStore.reloadChats();
      // Drop the just-deleted keys so a subsequent bulk action only acts on
      // the reloaded (and auto-select-recovered) list.
      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [multi.selectedKeys, clearSelection]);

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
        loadMore={() => void search.loadMore()}
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
            badge={
              chat.unread > 0 ? (
                <span className="imb-unread">
                  {chat.unread > 99 ? "99+" : chat.unread}
                </span>
              ) : undefined
            }
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
          <EmployeeAvatar employeeId={0} size={36} />
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
              <EmployeeAvatar
                employeeId={message.senderEmployeeId ?? 0}
                size={34}
              />
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
                <EmployeeAvatar
                  employeeId={message.senderEmployeeId}
                  size={34}
                />
              }
            />
          ),
        )}
      </div>
      <ChatInputBar onSend={handleSend} />
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
