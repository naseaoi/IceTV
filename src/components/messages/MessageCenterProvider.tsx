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
import { UserMessage, UserMessageSummary } from '@/lib/message-types';

import {
  getMessagePreviewMode,
  getMessagePreviewPage,
  getMessagePreviewSummary,
  getMessagePreviewToast,
} from './message-preview';
import MessagePanel from './MessagePanel';
import MessageToast from './MessageToast';
import { useMessagePagination } from './useMessagePagination';
import { useMessageSummaryPolling } from './useMessageSummaryPolling';

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
  announcement: null,
  latestTracking: null,
};

export function MessageCenterProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { session } = useAuthSession();
  const authenticated = session.status === 'authenticated';
  const username =
    session.status === 'authenticated' ? session.username : undefined;
  const [isOpen, setIsOpen] = useState(false);
  const previewModeRef = useRef<ReturnType<typeof getMessagePreviewMode>>(null);
  const panelOpenRef = useRef(false);
  const loadFirstPageRef = useRef<() => void>(() => {});

  const setPanelOpen = useCallback((open: boolean) => {
    panelOpenRef.current = open;
    setIsOpen(open);
  }, []);

  const reloadOpenPanel = useCallback(() => {
    if (!panelOpenRef.current) return;
    loadFirstPageRef.current();
  }, []);

  const { summary, setSummary, toastText, setToastText, refreshSummary } =
    useMessageSummaryPolling({
      authenticated,
      username,
      onRevisionChanged: reloadOpenPanel,
    });

  const onAfterMutate = useCallback(
    () => refreshSummary('local'),
    [refreshSummary],
  );
  const pagination = useMessagePagination({ previewModeRef, onAfterMutate });
  const { loadFirstPage, readOne, readAll, reset, setPage } = pagination;

  useEffect(() => {
    loadFirstPageRef.current = () => void loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    if (authenticated) return;
    reset();
    setPanelOpen(false);
  }, [authenticated, reset, setPanelOpen]);

  useEffect(() => {
    if (!authenticated) return;
    const previewMode = getMessagePreviewMode();
    if (!previewMode) return;
    previewModeRef.current = previewMode;
    const previewPage = getMessagePreviewPage();
    setPage(previewPage);
    setSummary(getMessagePreviewSummary(previewPage));
    if (previewMode === 'panel' || previewMode === 'all') {
      setPanelOpen(true);
    }
    if (previewMode !== 'panel') {
      setToastText(getMessagePreviewToast(previewMode));
    }
  }, [authenticated, setPage, setPanelOpen, setSummary, setToastText]);

  const openPanel = useCallback(() => {
    setToastText(null);
    setPanelOpen(true);
    void loadFirstPage();
  }, [loadFirstPage, setPanelOpen, setToastText]);

  const handleRead = useCallback(
    async (message: UserMessage, navigate = false) => {
      const read = await readOne(message);
      if (!read || !navigate || message.type !== 'tracking-update') return;
      const params = new URLSearchParams({
        source: message.source,
        id: message.videoId,
        title: message.title,
      });
      setPanelOpen(false);
      router.push(`/play?${params.toString()}`);
    },
    [readOne, router, setPanelOpen],
  );

  const handleReadAll = useCallback(async () => {
    const preview = previewModeRef.current;
    await readAll();
    if (preview) setSummary(EMPTY_SUMMARY);
  }, [readAll, setSummary]);

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
        page={pagination.page}
        loading={pagination.loading}
        loadingMore={pagination.loadingMore}
        loadError={pagination.loadError}
        workingIds={pagination.workingIds}
        onClose={() => setPanelOpen(false)}
        onRead={handleRead}
        onReadAll={handleReadAll}
        onLoadMore={pagination.loadMore}
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
