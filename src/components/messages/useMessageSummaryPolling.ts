'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  readNotifiedMessageAt,
  writeNotifiedMessageAt,
} from '@/lib/message-notification-preference';
import { UserMessageSummary } from '@/lib/message-types';
import { getMessageSummary } from '@/lib/messages.client';

import { createMessageSummaryPoller } from './message-summary-poller';
import { buildToastText, RefreshMode } from './message-toast-text';

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
  const pollerRef = useRef<ReturnType<
    typeof createMessageSummaryPoller
  > | null>(null);
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

  const refreshSummary = useCallback(async (mode: RefreshMode) => {
    await pollerRef.current?.refresh(mode);
  }, []);

  const setSummaryDirectly = useCallback((next: UserMessageSummary | null) => {
    summaryRef.current = next;
    setSummary(next);
  }, []);

  useEffect(() => {
    notifiedAtRef.current = 0;
    summaryRef.current = null;
    setSummary(null);
    if (!authenticated || !username) return;
    const poller = createMessageSummaryPoller({
      username,
      isCurrentAccount: () =>
        accountRef.current === username &&
        getAuthInfoFromBrowserCookie()?.username === username,
      load: getMessageSummary,
      onSummary: (nextSummary, mode) => {
        const previous = summaryRef.current;
        summaryRef.current = nextSummary;
        setSummary(nextSummary);
        notifyLatest(nextSummary);
        // local 刷新的列表已本地更新，其他标签页仍需重载。
        if (mode !== 'local' && previous?.revision !== nextSummary.revision) {
          onRevisionChangedRef.current();
        }
      },
    });
    pollerRef.current = poller;
    return () => {
      poller.stop();
      pollerRef.current = null;
    };
  }, [authenticated, username, notifyLatest]);

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
