import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isLivePageEffectivelyHidden,
  LIVE_INACTIVITY_CHECK_MS,
  shouldStopLiveForInactivity,
} from '@/features/live/lib/liveInactivityPolicy';

const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
] as const;

// 停止状态绑定在 streamKey 上，切换频道即视为恢复

export function useLiveInactivityStop({
  streamKey,
  isStreaming,
  onStop,
}: {
  streamKey: string;
  isStreaming: () => boolean;
  onStop: () => void;
}) {
  const [stoppedKey, setStoppedKey] = useState<string | null>(null);
  const stopped = stoppedKey !== null && stoppedKey === streamKey;
  const isStreamingRef = useRef(isStreaming);
  const onStopRef = useRef(onStop);
  const streamKeyRef = useRef(streamKey);
  isStreamingRef.current = isStreaming;
  onStopRef.current = onStop;
  streamKeyRef.current = streamKey;

  useEffect(() => {
    if (stopped) return;

    let lastActivityAt = Date.now();
    let hiddenSince: number | null = null;

    const markActive = () => {
      lastActivityAt = Date.now();
    };
    const syncHidden = () => {
      if (!isLivePageEffectivelyHidden(document)) {
        hiddenSince = null;
        return;
      }
      hiddenSince ??= Date.now();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') markActive();
      syncHidden();
    };
    const check = () => {
      syncHidden();
      if (!isStreamingRef.current()) return;
      if (
        !shouldStopLiveForInactivity({
          now: Date.now(),
          lastActivityAt,
          hiddenSince,
        })
      ) {
        return;
      }
      clearInterval(timer);
      setStoppedKey(streamKeyRef.current);
      onStopRef.current();
    };

    syncHidden();
    const listenerOptions = { capture: true, passive: true } as const;
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, markActive, listenerOptions);
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('enterpictureinpicture', syncHidden, true);
    document.addEventListener('leavepictureinpicture', syncHidden, true);
    const timer = setInterval(check, LIVE_INACTIVITY_CHECK_MS);

    return () => {
      clearInterval(timer);
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, markActive, listenerOptions);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('enterpictureinpicture', syncHidden, true);
      document.removeEventListener('leavepictureinpicture', syncHidden, true);
    };
  }, [stopped]);

  const resume = useCallback(() => setStoppedKey(null), []);

  return { stopped, resume };
}
