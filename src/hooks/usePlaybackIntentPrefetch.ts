import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import {
  canUseHoverPrefetch,
  canUseNetworkPrefetch,
  PREFETCH_INTENT_DELAY_MS,
  warmupForPlayback,
  warmupSearchForTitle,
} from '@/lib/video-prefetch';

export function usePlaybackIntentPrefetch({
  source,
  id,
  title,
  disabled = false,
  onPrefetch,
}: {
  source?: string;
  id?: string;
  title?: string;
  disabled?: boolean;
  onPrefetch?: () => void;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel, source, id, title, disabled]);
  const schedule = (hover: boolean) => {
    cancel();
    if (disabled || !(hover ? canUseHoverPrefetch() : canUseNetworkPrefetch()))
      return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!canUseNetworkPrefetch()) return;
      router.prefetch('/play');
      if (source && id) warmupForPlayback(source, id);
      else if (title) warmupSearchForTitle(title);
      onPrefetch?.();
    }, PREFETCH_INTENT_DELAY_MS);
  };
  return {
    onMouseEnter: () => schedule(true),
    onMouseLeave: cancel,
    onFocus: () => schedule(false),
    onBlur: cancel,
  };
}
