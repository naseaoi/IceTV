'use client';

import { useCallback, useRef } from 'react';

import { adminPost } from '@/features/admin/lib/api';
import { showError } from '@/features/admin/lib/notifications';
import { type ShowAlertFn } from '@/hooks/useAlertModal';

interface UseAdminSourceActionsOptions {
  endpoint: '/api/admin/source' | '/api/admin/category' | '/api/admin/live';
  refreshConfig: () => Promise<void>;
  afterRefresh?: () => Promise<void>;
  showAlert: ShowAlertFn;
}

export function useAdminSourceActions(options: UseAdminSourceActionsOptions) {
  const { endpoint, refreshConfig, afterRefresh, showAlert } = options;
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve());

  const runAction = useCallback(
    (payload: Record<string, unknown>, fallbackPrefix = '操作失败') => {
      const action = actionQueueRef.current.then(async () => {
        try {
          await adminPost(endpoint, payload, fallbackPrefix);
          await refreshConfig();
          await afterRefresh?.();
        } catch (err) {
          showError(
            err instanceof Error ? err.message : fallbackPrefix,
            showAlert,
          );
          throw err;
        }
      });
      actionQueueRef.current = action.catch(() => undefined);
      return action;
    },
    [afterRefresh, endpoint, refreshConfig, showAlert],
  );

  return { runAction };
}
