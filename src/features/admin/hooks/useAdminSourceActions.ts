'use client';

import { useCallback } from 'react';

import { type ShowAlertFn } from '@/features/admin/hooks/useAlertModal';
import { adminPost } from '@/features/admin/lib/api';
import { showError } from '@/features/admin/lib/notifications';

interface UseAdminSourceActionsOptions {
  endpoint: '/api/admin/source' | '/api/admin/category' | '/api/admin/live';
  refreshConfig: () => Promise<void>;
  showAlert: ShowAlertFn;
}

export function useAdminSourceActions(options: UseAdminSourceActionsOptions) {
  const { endpoint, refreshConfig, showAlert } = options;

  const runAction = useCallback(
    async (payload: Record<string, unknown>, fallbackPrefix = '操作失败') => {
      try {
        await adminPost(endpoint, payload, fallbackPrefix);
        await refreshConfig();
      } catch (err) {
        showError(
          err instanceof Error ? err.message : fallbackPrefix,
          showAlert,
        );
        throw err;
      }
    },
    [endpoint, refreshConfig, showAlert],
  );

  return { runAction };
}
