'use client';

import { useEffect } from 'react';

import { warmupDanmakuSearch } from '@/features/play/lib/danmaku/client';
import { hasDanmakuNavigationWarmup } from '@/features/play/lib/danmaku/navigation-warmup';
import { getRuntimeConfig } from '@/lib/runtime-config';

interface UseDanmakuWarmupOptions {
  enabledRef: { current: boolean };
  title: string;
}

export function useDanmakuWarmup({
  enabledRef,
  title,
}: UseDanmakuWarmupOptions): void {
  useEffect(() => {
    if (getRuntimeConfig()?.ENABLE_DANMAKU !== true) return;
    if (!enabledRef.current) return;

    const keyword = title.trim();
    if (!keyword) return;
    if (hasDanmakuNavigationWarmup(keyword)) return;
    warmupDanmakuSearch(keyword);
  }, [enabledRef, title]);
}
