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
  readNotifiedMessageRevision,
  writeNotifiedMessageRevision,
} from '@/lib/local-preferences';
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

import {
  getMessagePreviewMode,
  getMessagePreviewPage,
  getMessagePreviewSummary,
  getMessagePreviewToast,
} from './message-preview';
import MessagePanel from './MessagePanel';
import MessageToast from './MessageToast';

const POLL_INTERVAL_MS = 30_000;
const TOAST_DURATION_MS = 7_000;

type RefreshMode = 'mount' | 'poll' | 'silent';

interface MessageCenterContextValue {
  unreadCount: number;
  trackingUnreadCount: number | null;
  openPanel: () => void;
}

const MessageCenterContext = createContext<MessageCenterContextValue | null>(
  null,
);

const EMPTY_SUMMARY: UserMessageSummary = {
  unreadCount: 0,
  trackingUnreadCount: 0,
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
  const sessionStatus = session.status;
  const username =
    session.status === 'authenticated' ? session.username : undefined;
  const [summary, setSummary] = useState<UserMessageSummary | null>(null);
  const [page, setPage] = useState<UserMessagePage>({
    items: [],
    total: 0,
    nextCursor: null,
  });
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());
  const [toastText, setToastText] = useState<string | null>(null);
  const summaryRef = useRef<UserMessageSummary | null>(null);
  const openRef = useRef(false);
  const firstPageRequestRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const previewModeRef = useRef<ReturnType<typeof getMessagePreviewMode>>(null);

  useEffect(() => {
    openRef.current = isOpen;
  }, [isOpen]);

  const loadFirstPage = useCallback(async () => {
    const requestId = ++firstPageRequestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const previewMode = previewModeRef.current;
      if (previewMode) {
        setPage(getMessagePreviewPage());
        return;
      }
      const nextPage = await getMessagePage();
      if (requestId === firstPageRequestRef.current) {
        setPage(nextPage);
      }
    } catch (error) {
      console.error('加载消息列表失败:', error);
      if (requestId === firstPageRequestRef.current) {
        setLoadError('请检查网络连接后重试');
      }
    } finally {
      if (requestId === firstPageRequestRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const refreshSummary = useCallback(
    async (mode: RefreshMode) => {
      if (sessionStatus !== 'authenticated' || !username) return;
      try {
        const nextSummary = await getMessageSummary();
        const previous = summaryRef.current;
        summaryRef.current = nextSummary;
        setSummary(nextSummary);

        const baselineRevision =
          mode === 'mount'
            ? readNotifiedMessageRevision(username)
            : previous?.revision;
        const previousUnreadCount =
          mode === 'mount' ? 0 : (previous?.unreadCount ?? 0);
        if (
          mode !== 'silent' &&
          nextSummary.unreadCount > 0 &&
          nextSummary.revision !== baselineRevision &&
          nextSummary.unreadCount >= previousUnreadCount
        ) {
          setToastText(buildToastText(nextSummary, previousUnreadCount));
        }
        writeNotifiedMessageRevision(username, nextSummary.revision);

        if (openRef.current && previous?.revision !== nextSummary.revision) {
          void loadFirstPage();
        }
      } catch (error) {
        console.warn('刷新消息摘要失败:', error);
      }
    },
    [loadFirstPage, sessionStatus, username],
  );

  useEffect(() => {
    if (sessionStatus !== 'authenticated') {
      firstPageRequestRef.current += 1;
      summaryRef.current = null;
      setSummary(null);
      setPage({ items: [], total: 0, nextCursor: null });
      setLoadError(null);
      setIsOpen(false);
      return;
    }

    void refreshSummary('mount');

    let pollTimer: number | null = null;
    const stopPolling = () => {
      if (pollTimer === null) return;
      window.clearInterval(pollTimer);
      pollTimer = null;
    };
    const startPolling = () => {
      if (pollTimer !== null || document.visibilityState !== 'visible') return;
      pollTimer = window.setInterval(
        () => void refreshSummary('poll'),
        POLL_INTERVAL_MS,
      );
    };
    const handleVisible = () => {
      if (document.visibilityState !== 'visible') {
        stopPolling();
        return;
      }
      startPolling();
      void refreshSummary('poll');
    };
    const handleMessagesUpdated = () => void refreshSummary('silent');

    startPolling();
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleVisible);
    window.addEventListener('messagesUpdated', handleMessagesUpdated);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleVisible);
      window.removeEventListener('messagesUpdated', handleMessagesUpdated);
    };
  }, [refreshSummary, sessionStatus]);

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return;
    const previewMode = getMessagePreviewMode();
    if (!previewMode) return;
    previewModeRef.current = previewMode;
    const previewPage = getMessagePreviewPage();
    setPage(previewPage);
    setSummary(getMessagePreviewSummary(previewPage));
    if (previewMode === 'panel' || previewMode === 'all') {
      setIsOpen(true);
    }
    if (previewMode !== 'panel') {
      setToastText(getMessagePreviewToast(previewMode));
    }
  }, [sessionStatus]);

  useEffect(() => {
    if (!toastText) return;
    const timer = window.setTimeout(
      () => setToastText(null),
      TOAST_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [toastText]);

  const openPanel = useCallback(() => {
    setToastText(null);
    setIsOpen(true);
    void loadFirstPage();
  }, [loadFirstPage]);

  const handleRead = useCallback(
    async (message: UserMessage, navigate = false) => {
      if (previewModeRef.current) {
        setPage((current) => ({
          ...current,
          items: current.items.filter((item) => item.id !== message.id),
          total: Math.max(0, current.total - 1),
        }));
        return;
      }
      setWorkingIds((current) => new Set(current).add(message.id));
      try {
        await readMessage(message.id);
        setPage((current) => ({
          ...current,
          items: current.items.filter((item) => item.id !== message.id),
          total: Math.max(0, current.total - 1),
        }));
        await refreshSummary('silent');
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
    if (previewModeRef.current) {
      setPage({ items: [], total: 0, nextCursor: null });
      setSummary(EMPTY_SUMMARY);
      return;
    }
    setWorkingIds(new Set(['all']));
    try {
      await readAllMessages();
      setPage({ items: [], total: 0, nextCursor: null });
      await refreshSummary('silent');
    } catch (error) {
      console.error('全部标记已读失败:', error);
      triggerGlobalError('全部标记已读失败');
    } finally {
      setWorkingIds(new Set());
    }
  }, [refreshSummary]);

  const handleLoadMore = useCallback(async () => {
    if (!page.nextCursor || loadingMoreRef.current) return;
    const requestId = firstPageRequestRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = await getMessagePage(page.nextCursor);
      if (requestId !== firstPageRequestRef.current) return;
      setPage((current) => ({
        items: [...current.items, ...nextPage.items],
        total: nextPage.total,
        nextCursor: nextPage.nextCursor,
      }));
    } catch (error) {
      console.error('加载更多消息失败:', error);
      triggerGlobalError('加载更多消息失败');
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [page.nextCursor]);

  const contextValue = useMemo(
    () => ({
      unreadCount: summary?.unreadCount ?? 0,
      trackingUnreadCount: summary?.trackingUnreadCount ?? null,
      openPanel,
    }),
    [openPanel, summary?.trackingUnreadCount, summary?.unreadCount],
  );

  return (
    <MessageCenterContext.Provider value={contextValue}>
      {children}
      <MessagePanel
        open={isOpen}
        page={page}
        loading={loading}
        loadingMore={loadingMore}
        loadError={loadError}
        workingIds={workingIds}
        onClose={() => setIsOpen(false)}
        onRead={handleRead}
        onReadAll={handleReadAll}
        onLoadMore={handleLoadMore}
        onRetry={loadFirstPage}
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

export function useOptionalMessageCenter() {
  return useContext(MessageCenterContext);
}
