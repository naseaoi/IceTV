'use client';

import { useCallback, useState } from 'react';

import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { DisplayableError } from '@/lib/user-facing-error';

type SourceProxyMode = 'server' | 'browser' | 'auto';

type BatchAction =
  | 'batch_enable'
  | 'batch_disable'
  | 'batch_delete'
  | 'batch_set_proxy_mode'
  | 'batch_set_admin_only';

interface BatchOperationOptions {
  proxyMode?: SourceProxyMode;
  adminOnly?: boolean;
}

const proxyModeLabels: Record<SourceProxyMode, string> = {
  browser: '浏览器直连',
  server: '服务端代理',
  auto: '自动选择',
};

interface ConfirmModalState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const EMPTY_CONFIRM: ConfirmModalState = {
  isOpen: false,
  title: '',
  message: '',
  onConfirm: () => void 0,
  onCancel: () => void 0,
};

interface UseSourceBatchOperationOptions {
  selectedSources: Set<string>;
  onClearSelection: () => void;
  callSourceApi: (body: Record<string, unknown>) => Promise<void>;
  withLoading: ReturnType<typeof useLoadingState>['withLoading'];
}

export function useSourceBatchOperation({
  selectedSources,
  onClearSelection,
  callSourceApi,
  withLoading,
}: UseSourceBatchOperationOptions) {
  const [confirmModal, setConfirmModal] =
    useState<ConfirmModalState>(EMPTY_CONFIRM);

  const closeConfirmModal = useCallback(() => {
    setConfirmModal(EMPTY_CONFIRM);
  }, []);

  const requestBatchOperation = useCallback(
    (action: BatchAction, options: BatchOperationOptions = {}) => {
      if (selectedSources.size === 0) {
        throw new DisplayableError('请选择至少一个视频源');
      }

      const keys = Array.from(selectedSources);
      let confirmMessage = '';
      let loadingKey = `batchSource_${action}`;
      const body: Record<string, unknown> = { action, keys };

      switch (action) {
        case 'batch_enable':
          confirmMessage = `确定要启用选中的 ${keys.length} 个视频源吗？`;
          break;
        case 'batch_disable':
          confirmMessage = `确定要禁用选中的 ${keys.length} 个视频源吗？`;
          break;
        case 'batch_delete':
          confirmMessage = `确定要删除选中的 ${keys.length} 个视频源吗？此操作不可恢复！`;
          break;
        case 'batch_set_proxy_mode': {
          const proxyMode = options.proxyMode;
          if (!proxyMode) {
            throw new DisplayableError('请选择流量路由');
          }
          const proxyModeLabel = proxyModeLabels[proxyMode];
          confirmMessage = `将选中的 ${keys.length} 个视频源设为「${proxyModeLabel}」吗？`;
          loadingKey = `${loadingKey}_${proxyMode}`;
          body.proxyMode = proxyMode;
          break;
        }
        case 'batch_set_admin_only': {
          const adminOnly = options.adminOnly === true;
          confirmMessage = adminOnly
            ? `确定要将选中的 ${keys.length} 个视频源设为「仅管理员可用」吗？普通用户将无法搜索和播放这些源。`
            : `确定要将选中的 ${keys.length} 个视频源对所有用户开放吗？`;
          loadingKey = `${loadingKey}_${adminOnly ? 'on' : 'off'}`;
          body.adminOnly = adminOnly;
          break;
        }
      }

      setConfirmModal({
        isOpen: true,
        title: '确认操作',
        message: confirmMessage,
        onConfirm: async () => {
          await withLoading(loadingKey, () => callSourceApi(body));
          onClearSelection();
          closeConfirmModal();
        },
        onCancel: closeConfirmModal,
      });
    },
    [
      selectedSources,
      callSourceApi,
      withLoading,
      onClearSelection,
      closeConfirmModal,
    ],
  );

  return {
    confirmModal,
    closeConfirmModal,
    requestBatchOperation,
  };
}
