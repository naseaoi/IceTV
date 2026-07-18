'use client';

import { useCallback, useRef } from 'react';

import { adminGet } from '@/features/admin/lib/api';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import { type ShowAlertFn } from '@/hooks/useAlertModal';
import { type AdminConfigResult } from '@/types/admin';

type AdminAuthStatus = {
  authenticated: boolean;
  role: AdminConfigResult['Role'] | 'user' | null;
};

interface UseAdminPageActionsOptions {
  showAlert: ShowAlertFn;
  setConfig: (config: AdminConfigResult['Config']) => void;
  setRole: (role: AdminConfigResult['Role']) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export function useAdminPageActions(options: UseAdminPageActionsOptions) {
  const { showAlert, setConfig, setRole, setError, setLoading } = options;
  const requestIdRef = useRef(0);

  const fetchConfig = useCallback(
    async (showLoading = false) => {
      const requestId = ++requestIdRef.current;
      try {
        if (showLoading) {
          setLoading(true);
        }

        const authStatus = await adminGet<AdminAuthStatus>(
          '/api/auth/status',
          '获取登录状态失败',
        );
        if (!authStatus.authenticated) {
          throw new Error('Unauthorized');
        }
        if (authStatus.role !== 'owner' && authStatus.role !== 'admin') {
          throw new Error('权限不足');
        }

        const data = await adminGet<AdminConfigResult>(
          '/api/admin/config',
          '获取配置失败',
        );
        if (requestId !== requestIdRef.current) {
          return;
        }
        setConfig(data.Config);
        setRole(data.Role);
        setError(null);
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        const msg = err instanceof Error ? err.message : '获取配置失败';
        showError(msg, showAlert);
        setError(msg);
      } finally {
        if (showLoading && requestId === requestIdRef.current) {
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
