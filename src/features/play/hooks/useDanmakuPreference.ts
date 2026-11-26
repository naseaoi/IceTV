'use client';

import { useCallback, useEffect, useRef } from 'react';

import { updateDanmakuWarmupPreference } from '@/features/play/lib/danmaku/navigation-warmup';
import { showToast } from '@/lib/toast';

export type InitialDanmakuEnabled = boolean | null;

async function saveAccountDanmakuPreference(
  enabled: boolean,
): Promise<boolean> {
  try {
    const response = await fetch('/api/danmaku/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface UseDanmakuPreferenceResult {
  enabledRef: { current: boolean };
  onEnabledChange: (enabled: boolean) => void;
}

export function useDanmakuPreference(
  initialEnabled: InitialDanmakuEnabled,
): UseDanmakuPreferenceResult {
  const enabledRef = useRef(initialEnabled ?? false);
  const saveQueueRef = useRef(Promise.resolve());

  const onEnabledChange = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
    updateDanmakuWarmupPreference(enabled);
    saveQueueRef.current = saveQueueRef.current
      .catch(() => {})
      .then(async () => {
        const saved = await saveAccountDanmakuPreference(enabled);
        if (!saved) {
          showToast('弹幕开关未能同步到账号', 'error', {
            key: 'danmaku-preference-sync',
          });
        }
      });
  }, []);

  useEffect(() => {
    updateDanmakuWarmupPreference(enabledRef.current);
  }, []);

  return { enabledRef, onEnabledChange };
}
