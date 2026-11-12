'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useVisibilityPolling } from '@/hooks/useVisibilityPolling';
import {
  readNotifiedMessageAt,
  writeNotifiedMessageAt,
} from '@/lib/message-notification-preference';
import { UserMessageSummary } from '@/lib/message-types';
import { getMessageSummary } from '@/lib/messages.client';

import { buildToastText, RefreshMode } from './message-toast-text';

const POLL_INTERVAL_MS = 30_000;
const EXTERNAL_REFRESH_DEBOUNCE_MS = 400;

interface MessageSummaryPollingOptions {
  authenticated: boolean;
  username?: string;
  isPanelOpen: () => boolean;
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
  isPanelOpen,
  onNotify,
}: MessageSummaryPollingOptions): MessageSummaryPolling {
  const [summary, setSummary] = useState<UserMessageSummary | null>(null);
  const summaryRef = useRef<UserMessageSummary | null>(null);
  const onRevisionChangedRef = useRef(onRevisionChanged);
  const onNotifyRef = useRef(onNotify);
  const notifiedAtRef = useRef(0);
  const requestSequence = useRef(0);
  const appliedSequence = useRef(0);
  const accountRef = useRef(username);
  accountRef.current = username;

  const notifyLatest = useCallback(
    (next: UserMessageSummary) => {
      if (
        !username ||
        accountRef.current !== username ||
        document.visibilityState !== 'visible' ||
        !document.hasFocus()
      )
        return;
      const baseline = Math.max(
        notifiedAtRef.current,
        readNotifiedMessageAt(username),
      );
      if (!next.latestUnread || next.latestUnreadAt <= baseline) return;
      notifiedAtRef.current = next.latestUnreadAt;
      writeNotifiedMessageAt(username, next.latestUnreadAt);
      if (!isPanelOpen()) onNotifyRef.current(buildToastText(next));
    },
    [username, isPanelOpen],
  );

  useEffect(() => {
    onRevisionChangedRef.current = onRevisionChanged;
    onNotifyRef.current = onNotify;
  }, [onNotify, onRevisionChanged]);

  const refreshSummary = useCallback(
    async (mode: RefreshMode) => {
      if (!authenticated || !username) return;
      const sequence = ++requestSequence.current;
      try {
        const nextSummary = await getMessageSummary();
        if (
          accountRef.current !== username ||
          sequence < appliedSequence.current
        )
          return;
        appliedSequence.current = sequence;
        const previous = summaryRef.current;
        summaryRef.current = nextSummary;
        setSummary(nextSummary);

        notifyLatest(nextSummary);

        // local 刷新的列表已本地更新，无需通知重载
        if (mode !== 'local' && previous?.revision !== nextSummary.revision) {
          onRevisionChangedRef.current();
        }
      } catch (error) {
        console.warn('刷新消息摘要失败:', error);
      }
    },
    [authenticated, username, notifyLatest],
  );

  const setSummaryDirectly = useCallback((next: UserMessageSummary | null) => {
    summaryRef.current = next;
    setSummary(next);
  }, []);

  useEffect(() => {
    notifiedAtRef.current = 0;
    summaryRef.current = null;
    setSummary(null);
    if (!authenticated) return;
    void refreshSummary('mount');
  }, [authenticated, refreshSummary]);

  useEffect(() => {
    const onFocus = () => {
      if (summaryRef.current) notifyLatest(summaryRef.current);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [notifyLatest]);

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
