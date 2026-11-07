'use client';

import dynamic from 'next/dynamic';
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
import { dismissToast, showToast } from '@/lib/toast';

import {
  getMessagePreviewMode,
  getMessagePreviewPage,
  getMessagePreviewSummary,
  getMessagePreviewToast,
} from './message-preview';
import { useMessagePagination } from './useMessagePagination';
import { useMessageSummaryPolling } from './useMessageSummaryPolling';

const MessagePanel = dynamic(
  () => import('@/components/messages/MessagePanel'),
  { ssr: false },
);

interface MessageCenterContextValue {
  unreadCount: number;
  trackingUnreadCount: number | null;
  followReviewUnreadCount: number | null;
  openPanel: () => void;
}

const MessageCenterContext = createContext<MessageCenterContextValue | null>(
  null,
);

const MESSAGE_TOAST_KEY = 'messages';
const MESSAGE_TOAST_DURATION_MS = 7_000;

const EMPTY_SUMMARY: UserMessageSummary = {
  unreadCount: 0,
  trackingUnreadCount: 0,
  reviewReplyUnreadCount: 0,
  newFollowerUnreadCount: 0,
  reviewLikeUnreadCount: 0,
  followReviewUnreadCount: 0,
  revision: '',
  announcement: null,
  latestTracking: null,
};

export function MessageCenterProvider({ children }: { children: ReactNode }) {
  const { session } = useAuthSession();
  const authenticated = session.status === 'authenticated';
  const username =
    session.status === 'authenticated' ? session.username : undefined;
  const [isOpen, setIsOpen] = useState(false);
  // 首次打开后才加载面板代码，之后常驻以便播放退场
  const [panelLoaded, setPanelLoaded] = useState(false);
  if (isOpen && !panelLoaded) setPanelLoaded(true);
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

  const openPanelRef = useRef<() => void>(() => {});
  const notify = useCallback((text: string) => {
    showToast(text, 'notice', {
      key: MESSAGE_TOAST_KEY,
      duration: MESSAGE_TOAST_DURATION_MS,
      action: { label: '查看', onClick: () => openPanelRef.current() },
    });
  }, []);

  const { summary, setSummary, refreshSummary } = useMessageSummaryPolling({
    authenticated,
    username,
    onRevisionChanged: reloadOpenPanel,
    onNotify: notify,
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
      notify(getMessagePreviewToast(previewMode));
    }
  }, [authenticated, notify, setPage, setPanelOpen, setSummary]);

  const openPanel = useCallback(() => {
    dismissToast(MESSAGE_TOAST_KEY);
    setPanelOpen(true);
    void loadFirstPage();
  }, [loadFirstPage, setPanelOpen]);

  useEffect(() => {
    openPanelRef.current = openPanel;
  }, [openPanel]);

  const handleRead = useCallback(
    async (message: UserMessage) => {
      await readOne(message);
    },
    [readOne],
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
      reviewReplyUnreadCount: 0,
      followReviewUnreadCount: summary?.followReviewUnreadCount ?? null,
      openPanel,
    }),
    [
      openPanel,
      summary?.trackingUnreadCount,
      summary?.followReviewUnreadCount,
      summary?.unreadCount,
    ],
  );

  return (
    <MessageCenterContext.Provider value={contextValue}>
      {children}
      {panelLoaded && (
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
          onSettingsSaved={() => {
            void loadFirstPage();
            void refreshSummary('local');
          }}
        />
      )}
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
