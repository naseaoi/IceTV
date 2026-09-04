'use client';

import { useCallback, useEffect, useRef } from 'react';

import {
  clearStoredDanmakuEnabled,
  readStoredDanmakuEnabled,
} from '@/lib/local-preferences';

export type InitialDanmakuEnabled = boolean | null;

function resolveInitialValue(initialEnabled: InitialDanmakuEnabled): boolean {
  if (initialEnabled !== null) return initialEnabled;
  return readStoredDanmakuEnabled() ?? false;
}

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
  const legacyValueRef = useRef(
    initialEnabled === null ? readStoredDanmakuEnabled() : undefined,
  );
  const enabledRef = useRef(resolveInitialValue(initialEnabled));
  const saveQueueRef = useRef(Promise.resolve());

  const onEnabledChange = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
    saveQueueRef.current = saveQueueRef.current
      .catch(() => {})
      .then(async () => {
        const saved = await saveAccountDanmakuPreference(enabled);
        if (saved && enabledRef.current === enabled) {
          clearStoredDanmakuEnabled();
        }
        if (!saved) {
          console.warn('弹幕开关同步失败');
        }
      });
  }, []);

  useEffect(() => {
    if (initialEnabled !== null) {
      clearStoredDanmakuEnabled();
      return;
    }

    const legacyValue = legacyValueRef.current;
    if (legacyValue === undefined) return;

    onEnabledChange(legacyValue);
  }, [initialEnabled, onEnabledChange]);

  return { enabledRef, onEnabledChange };
}
