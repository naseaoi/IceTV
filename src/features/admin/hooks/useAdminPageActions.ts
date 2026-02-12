'use client';

import { useCallback } from 'react';

import { adminGet } from '@/features/admin/lib/api';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { type ShowAlertFn } from '@/features/admin/hooks/useAlertModal';
import { type AdminConfigResult } from '@/features/admin/types/api';

interface UseAdminPageActionsOptions {
  showAlert: ShowAlertFn;
  setConfig: (config: AdminConfigResult['Config']) => void;
  setRole: (role: AdminConfigResult['Role']) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export function useAdminPageActions(options: UseAdminPageActionsOptions) {
  const { showAlert, setConfig, setRole, setError, setLoading } = options;

  const fetchConfig = useCallback(
    async (showLoading = false) => {
      try {
        if (showLoading) {
          setLoading(true);
        }

        const data = await adminGet<AdminConfigResult>(
          '/api/admin/config',
          '获取配置失败',
        );
        setConfig(data.Config);
        setRole(data.Role);
        setError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '获取配置失败';
        showError(msg, showAlert);
        setError(msg);
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [setConfig, setError, setLoading, setRole, showAlert],
  );

  const resetConfig = useCallback(async () => {
    await adminGet('/api/admin/reset', '重置失败');
    showSuccess('重置成功，请刷新页面！', showAlert);
  }, [showAlert]);

  return { fetchConfig, resetConfig };
}
