import type { UserMessageSummary } from '@/lib/message-types';

import type { RefreshMode } from './message-toast-text';

export const MESSAGE_POLL_INTERVAL_MS = 60_000;
const MIN_REFRESH_GAP_MS = 1_000;

type Snapshot = { summary: UserMessageSummary; requestedAt: number };

// 锁只决定哪个可见标签页定时查询；操作后的刷新仍可由操作页立即发起。
export function createMessageSummaryPoller({
  username,
  isCurrentAccount = () => true,
  load,
  onSummary,
}: {
  username: string;
  isCurrentAccount?: () => boolean;
  load: () => Promise<UserMessageSummary>;
  onSummary: (summary: UserMessageSummary, mode: RefreshMode) => void;
}) {
  const key = `icetv:message-summary:${username}`;
  const coordinated =
    typeof BroadcastChannel !== 'undefined' && !!navigator.locks;
  const channel = coordinated ? new BroadcastChannel(key) : null;
  let stopped = false;
  let leader = false;
  let snapshot: Snapshot | null = null;
  let lastRequestAt = 0;
  let sequence = 0;
  let appliedSequence = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let election: AbortController | undefined;
  let releaseLeader: (() => void) | undefined;

  const accept = (next: Snapshot, mode: RefreshMode) => {
    if (
      stopped ||
      !isCurrentAccount() ||
      (snapshot && next.requestedAt < snapshot.requestedAt)
    )
      return;
    snapshot = next;
    lastRequestAt = Math.max(lastRequestAt, next.requestedAt);
    onSummary(next.summary, mode);
  };

  const refresh = async (mode: RefreshMode): Promise<void> => {
    const run = async () => {
      if (stopped || !isCurrentAccount()) return;
      // 显式写入后的刷新不受可见性和补拉节流限制。
      if (
        (mode === 'mount' || mode === 'poll') &&
        Date.now() - lastRequestAt < MIN_REFRESH_GAP_MS
      )
        return;
      const requestSequence = ++sequence;
      const requestedAt = Math.max(Date.now(), lastRequestAt + 1);
      lastRequestAt = requestedAt;
      try {
        const summary = await load();
        if (stopped || !isCurrentAccount() || requestSequence < appliedSequence)
          return;
        appliedSequence = requestSequence;
        const next = { summary, requestedAt };
        accept(next, mode);
        channel?.postMessage({ type: 'summary', ...next });
      } catch (error) {
        if (!stopped) console.warn('刷新消息摘要失败:', error);
      }
    };
    if (channel) {
      // 所有标签页的查询串行，写操作完成后的刷新排在旧查询之后。
      await navigator.locks.request(`${key}:request`, run);
    } else {
      await run();
    }
  };

  const startTimer = () => {
    timer = setInterval(() => void refresh('poll'), MESSAGE_POLL_INTERVAL_MS);
  };
  const stopLeader = () => {
    clearInterval(timer);
    timer = undefined;
    election?.abort();
    election = undefined;
    releaseLeader?.();
    releaseLeader = undefined;
    leader = false;
  };
  const elect = () => {
    if (
      stopped ||
      !isCurrentAccount() ||
      document.visibilityState !== 'visible' ||
      election
    )
      return;
    if (!channel) {
      if (!timer) startTimer();
      return;
    }
    const controller = new AbortController();
    election = controller;
    void navigator.locks
      .request(key, { signal: controller.signal }, async () => {
        if (stopped || !isCurrentAccount() || controller.signal.aborted) return;
        leader = true;
        const released = new Promise<void>((resolve) => {
          releaseLeader = resolve;
        });
        void refresh('mount');
        startTimer();
        await released;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          console.warn('消息轮询选主失败:', error);
      });
  };
  const onVisible = () => {
    if (document.visibilityState !== 'visible') {
      stopLeader();
      return;
    }
    elect();
    if (!channel || leader) void refresh('poll');
    else channel.postMessage({ type: 'refresh' });
  };

  if (channel) {
    channel.onmessage = ({ data }) => {
      if (data?.type === 'summary') accept(data as Snapshot, 'external');
      else if (data?.type === 'refresh' && leader) void refresh('poll');
      else if (data?.type === 'hello' && snapshot) {
        channel.postMessage({ type: 'summary', ...snapshot });
      }
    };
    channel.postMessage({ type: 'hello' });
  } else {
    void refresh('mount');
  }
  elect();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('pagehide', stopLeader);
  window.addEventListener('pageshow', onVisible);

  return {
    refresh,
    stop() {
      stopped = true;
      stopLeader();
      channel?.close();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pagehide', stopLeader);
      window.removeEventListener('pageshow', onVisible);
    },
  };
}
