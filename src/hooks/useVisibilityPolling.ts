'use client';

import { useEffect, useRef } from 'react';

interface VisibilityPollingOptions {
  enabled: boolean;
  intervalMs: number;
  minGapMs?: number;
  onPoll: () => void;
}

const DEFAULT_MIN_GAP_MS = 1_000;

// 仅在页面可见时按间隔轮询，重新可见或聚焦时立即补一次
export function useVisibilityPolling({
  enabled,
  intervalMs,
  minGapMs = DEFAULT_MIN_GAP_MS,
  onPoll,
}: VisibilityPollingOptions): void {
  const onPollRef = useRef(onPoll);

  useEffect(() => {
    onPollRef.current = onPoll;
  }, [onPoll]);

  useEffect(() => {
    if (!enabled) return;

    let timer: number | null = null;
    let lastPollAt = 0;
    const poll = () => {
      lastPollAt = Date.now();
      onPollRef.current();
    };
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer !== null || document.visibilityState !== 'visible') return;
      timer = window.setInterval(poll, intervalMs);
    };
    const handleVisible = () => {
      if (document.visibilityState !== 'visible') {
        stop();
        return;
      }
      start();
      if (Date.now() - lastPollAt < minGapMs) return;
      poll();
    };

    start();
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleVisible);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleVisible);
    };
  }, [enabled, intervalMs, minGapMs]);
}
