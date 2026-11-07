'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useVisibilityPolling } from '@/hooks/useVisibilityPolling';
import {
  readNotifiedMessageRevision,
  writeNotifiedMessageRevision,
} from '@/lib/local-preferences';
import { UserMessageSummary } from '@/lib/message-types';
import { getMessageSummary } from '@/lib/messages.client';

import { buildToastText, RefreshMode } from './message-toast-text';

const POLL_INTERVAL_MS = 30_000;
const EXTERNAL_REFRESH_DEBOUNCE_MS = 400;

interface MessageSummaryPollingOptions {
  authenticated: boolean;
  username?: string;
  onRevisionChanged: () => void;
  onNotify: (text: string) => void;
}

export interface MessageSummaryPolling {
  summary: UserMessageSummary | null;
  setSummary: (summary: UserMessageSummary | null) => void;
  refreshSummary: (mode: RefreshMode) => Promise<void>;
}

export function useMessageSummaryPolling({
  authenticated,
  username,
  onRevisionChanged,
  onNotify,
}: MessageSummaryPollingOptions): MessageSummaryPolling {
  const [summary, setSummary] = useState<UserMessageSummary | null>(null);
  const summaryRef = useRef<UserMessageSummary | null>(null);
  const onRevisionChangedRef = useRef(onRevisionChanged);
  const onNotifyRef = useRef(onNotify);

  useEffect(() => {
    onRevisionChangedRef.current = onRevisionChanged;
    onNotifyRef.current = onNotify;
  }, [onNotify, onRevisionChanged]);

  const refreshSummary = useCallback(
    async (mode: RefreshMode) => {
      if (!authenticated || !username) return;
      try {
        const nextSummary = await getMessageSummary();
        const previous = summaryRef.current;
        summaryRef.current = nextSummary;
        setSummary(nextSummary);

        const baselineRevision =
          mode === 'mount'
            ? readNotifiedMessageRevision(username)
            : previous?.revision;
        const notifiable = mode === 'mount' || mode === 'poll';
        if (
          notifiable &&
          nextSummary.unreadCount > 0 &&
          nextSummary.revision !== baselineRevision &&
          nextSummary.unreadCount >= (previous?.unreadCount ?? 0)
        ) {
          onNotifyRef.current(buildToastText(nextSummary, previous, mode));
        }
        writeNotifiedMessageRevision(username, nextSummary.revision);

        // local 刷新的列表已本地更新，无需通知重载
        if (mode !== 'local' && previous?.revision !== nextSummary.revision) {
          onRevisionChangedRef.current();
        }
      } catch (error) {
        console.warn('刷新消息摘要失败:', error);
      }
    },
    [authenticated, username],
  );

  const setSummaryDirectly = useCallback((next: UserMessageSummary | null) => {
    summaryRef.current = next;
    setSummary(next);
  }, []);

  useEffect(() => {
    if (!authenticated) {
      summaryRef.current = null;
      setSummary(null);
      return;
    }
    void refreshSummary('mount');
  }, [authenticated, refreshSummary]);

  useVisibilityPolling({
    enabled: authenticated,
    intervalMs: POLL_INTERVAL_MS,
    onPoll: useCallback(() => void refreshSummary('poll'), [refreshSummary]),
  });

  useEffect(() => {
    if (!authenticated) return;
    let timer: number | null = null;
    const handleMessagesUpdated = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void refreshSummary('external');
      }, EXTERNAL_REFRESH_DEBOUNCE_MS);
    };
    window.addEventListener('messagesUpdated', handleMessagesUpdated);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('messagesUpdated', handleMessagesUpdated);
    };
  }, [authenticated, refreshSummary]);

  return {
    summary,
    setSummary: setSummaryDirectly,
    refreshSummary,
  };
}
