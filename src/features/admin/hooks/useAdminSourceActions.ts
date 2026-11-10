'use client';

import { useCallback, useRef } from 'react';

import { adminPost } from '@/features/admin/lib/api';

interface UseAdminSourceActionsOptions {
  endpoint: '/api/admin/source' | '/api/admin/category' | '/api/admin/live';
  refreshConfig: () => Promise<void>;
  afterRefresh?: () => Promise<void>;
}

export function useAdminSourceActions(options: UseAdminSourceActionsOptions) {
  const { endpoint, refreshConfig, afterRefresh } = options;
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve());

  const runAction = useCallback(
    (payload: Record<string, unknown>, fallbackPrefix = '操作失败') => {
      const action = actionQueueRef.current.then(async () => {
        await adminPost(endpoint, payload, fallbackPrefix);
        await refreshConfig();
        await afterRefresh?.();
      });
      actionQueueRef.current = action.catch(() => undefined);
      return action;
    },
    [afterRefresh, endpoint, refreshConfig],
  );

  return { runAction };
}
