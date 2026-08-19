'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import { triggerGlobalError } from '@/lib/db.client.internal';
import {
  UserMessage,
  UserMessagePage,
  UserMessageSummary,
} from '@/lib/message-types';
import {
  getMessagePage,
  getMessageSummary,
  readAllMessages,
  readMessage,
} from '@/lib/messages.client';

import MessagePanel from './MessagePanel';
import MessageToast from './MessageToast';

const POLL_INTERVAL_MS = 30_000;
const TOAST_DURATION_MS = 7_000;

export interface MessagePanelAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface MessageCenterContextValue {
  unreadCount: number;
  openPanel: (anchor?: MessagePanelAnchor) => void;
}

const MessageCenterContext = createContext<MessageCenterContextValue | null>(
  null,
);

const EMPTY_SUMMARY: UserMessageSummary = {
  unreadCount: 0,
  revision: '',
  latestMessage: null,
};

function buildToastText(
  summary: UserMessageSummary,
  previousCount: number,
): string {
  const addedCount = Math.max(1, summary.unreadCount - previousCount);
  if (addedCount > 1) return `${addedCount} 条新消息`;
  const latest = summary.latestMessage;
  if (!latest) return '有新消息';
  if (latest.type === 'announcement') return '有一条新公告';
  return `《${latest.title}》已更新至第 ${latest.toEpisodes} 集`;
}

export function MessageCenterProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { session } = useAuthSession();
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [page, setPage] = useState<UserMessagePage>({
    items: [],
    total: 0,
    nextCursor: null,
  });
  const [isOpen, setIsOpen] = useState(false);
  const [anchor, setAnchor] = useState<MessagePanelAnchor | undefined>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());
  const [toastText, setToastText] = useState<string | null>(null);
  const summaryRef = useRef<UserMessageSummary | null>(null);
  const openRef = useRef(false);

  useEffect(() => {
    openRef.current = isOpen;
  }, [isOpen]);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    try {
      setPage(await getMessagePage());
    } catch (error) {
      console.error('加载消息列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSummary = useCallback(
    async (showToast: boolean) => {
      if (session.status !== 'authenticated') return;
      try {
        const nextSummary = await getMessageSummary();
        const previous = summaryRef.current;
        summaryRef.current = nextSummary;
        setSummary(nextSummary);

        if (
          showToast &&
          previous &&
          nextSummary.unreadCount > 0 &&
          nextSummary.revision !== previous.revision &&
          nextSummary.unreadCount >= previous.unreadCount
        ) {
          setToastText(buildToastText(nextSummary, previous.unreadCount));
        }
        if (openRef.current && previous?.revision !== nextSummary.revision) {
          void loadFirstPage();
        }
      } catch (error) {
        console.warn('刷新消息摘要失败:', error);
      }
    },
    [loadFirstPage, session.status],
  );

  useEffect(() => {
    if (session.status !== 'authenticated') {
      summaryRef.current = null;
      setSummary(EMPTY_SUMMARY);
      setIsOpen(false);
      return;
    }

    void refreshSummary(false);
    const interval = window.setInterval(
      () => void refreshSummary(true),
      POLL_INTERVAL_MS,
    );
    const handleVisible = () => {
      if (document.visibilityState === 'visible') void refreshSummary(true);
    };
    const handleMessagesUpdated = () => void refreshSummary(false);
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleVisible);
    window.addEventListener('messagesUpdated', handleMessagesUpdated);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleVisible);
      window.removeEventListener('messagesUpdated', handleMessagesUpdated);
    };
  }, [refreshSummary, session.status]);

  useEffect(() => {
    if (!toastText) return;
    const timer = window.setTimeout(
      () => setToastText(null),
      TOAST_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [toastText]);

  const openPanel = useCallback(
    (nextAnchor?: MessagePanelAnchor) => {
      setAnchor(nextAnchor);
      setToastText(null);
      setIsOpen(true);
      void loadFirstPage();
    },
    [loadFirstPage],
  );

  const handleRead = useCallback(
    async (message: UserMessage, navigate = false) => {
      setWorkingIds((current) => new Set(current).add(message.id));
      try {
        await readMessage(message.id);
        setPage((current) => ({
          ...current,
          items: current.items.filter((item) => item.id !== message.id),
          total: Math.max(0, current.total - 1),
        }));
        await refreshSummary(false);
        if (navigate && message.type === 'tracking-update') {
          const params = new URLSearchParams({
            source: message.source,
            id: message.videoId,
            title: message.title,
          });
          setIsOpen(false);
          router.push(`/play?${params.toString()}`);
        }
      } catch (error) {
        console.error('标记消息已读失败:', error);
        triggerGlobalError('标记消息已读失败');
      } finally {
        setWorkingIds((current) => {
          const next = new Set(current);
          next.delete(message.id);
          return next;
        });
      }
    },
    [refreshSummary, router],
  );

  const handleReadAll = useCallback(async () => {
    setWorkingIds(new Set(['all']));
    try {
      await readAllMessages();
      setPage({ items: [], total: 0, nextCursor: null });
      await refreshSummary(false);
    } catch (error) {
      console.error('全部标记已读失败:', error);
      triggerGlobalError('全部标记已读失败');
    } finally {
      setWorkingIds(new Set());
    }
  }, [refreshSummary]);

  const handleLoadMore = useCallback(async () => {
    if (!page.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const nextPage = await getMessagePage(page.nextCursor);
      setPage((current) => ({
        items: [...current.items, ...nextPage.items],
        total: nextPage.total,
        nextCursor: nextPage.nextCursor,
      }));
    } catch (error) {
      console.error('加载更多消息失败:', error);
      triggerGlobalError('加载更多消息失败');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, page.nextCursor]);

  const contextValue = useMemo(
    () => ({ unreadCount: summary.unreadCount, openPanel }),
    [openPanel, summary.unreadCount],
  );

  return (
    <MessageCenterContext.Provider value={contextValue}>
      {children}
      <MessagePanel
        open={isOpen}
        anchor={anchor}
        page={page}
        loading={loading}
        loadingMore={loadingMore}
        workingIds={workingIds}
        onClose={() => setIsOpen(false)}
        onRead={handleRead}
        onReadAll={handleReadAll}
        onLoadMore={handleLoadMore}
      />
      <MessageToast
        text={toastText}
        onClose={() => setToastText(null)}
        onOpen={() => openPanel()}
      />
    </MessageCenterContext.Provider>
  );
}

export function useMessageCenter() {
  const context = useContext(MessageCenterContext);
  if (!context) {
    throw new Error('useMessageCenter 必须在 MessageCenterProvider 内使用');
  }
  return context;
}
