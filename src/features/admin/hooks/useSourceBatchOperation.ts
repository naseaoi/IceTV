'use client';

import { useCallback, useState } from 'react';

import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { useAlertModal } from '@/hooks/useAlertModal';
import { showToast } from '@/lib/toast';

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
  showAlert: ReturnType<typeof useAlertModal>['showAlert'];
}

export function useSourceBatchOperation({
  selectedSources,
  onClearSelection,
  callSourceApi,
  withLoading,
  showAlert,
}: UseSourceBatchOperationOptions) {
  const [confirmModal, setConfirmModal] =
    useState<ConfirmModalState>(EMPTY_CONFIRM);

  const closeConfirmModal = useCallback(() => {
    setConfirmModal(EMPTY_CONFIRM);
  }, []);

  const requestBatchOperation = useCallback(
    (action: BatchAction, options: BatchOperationOptions = {}) => {
      if (selectedSources.size === 0) {
        showAlert({
          type: 'warning',
          title: '请先选择要操作的视频源',
          message: '请选择至少一个视频源',
        });
        return;
      }

      const keys = Array.from(selectedSources);
      let confirmMessage = '';
      let actionName = '';
      let successMessage = '';
      let loadingKey = `batchSource_${action}`;
      const body: Record<string, unknown> = { action, keys };

      switch (action) {
        case 'batch_enable':
          confirmMessage = `确定要启用选中的 ${keys.length} 个视频源吗？`;
          actionName = '启用';
          successMessage = `启用了 ${keys.length} 个视频源`;
          break;
        case 'batch_disable':
          confirmMessage = `确定要禁用选中的 ${keys.length} 个视频源吗？`;
          actionName = '禁用';
          successMessage = `禁用了 ${keys.length} 个视频源`;
          break;
        case 'batch_delete':
          confirmMessage = `确定要删除选中的 ${keys.length} 个视频源吗？此操作不可恢复！`;
          actionName = '删除';
          successMessage = `删除了 ${keys.length} 个视频源`;
          break;
        case 'batch_set_proxy_mode': {
          const proxyMode = options.proxyMode;
          if (!proxyMode) {
            showAlert({
              type: 'error',
              title: '参数错误',
              message: '缺少流量路由参数',
            });
            return;
          }
          const proxyModeLabel = proxyModeLabels[proxyMode];
          confirmMessage = `将选中的 ${keys.length} 个视频源设为「${proxyModeLabel}」吗？`;
          actionName = `设置${proxyModeLabel}`;
          successMessage = `已将 ${keys.length} 个视频源设为「${proxyModeLabel}」`;
          loadingKey = `${loadingKey}_${proxyMode}`;
          body.proxyMode = proxyMode;
          break;
        }
        case 'batch_set_admin_only': {
          const adminOnly = options.adminOnly === true;
          const scopeLabel = adminOnly ? '仅管理员可用' : '所有用户可用';
          confirmMessage = adminOnly
            ? `确定要将选中的 ${keys.length} 个视频源设为「仅管理员可用」吗？普通用户将无法搜索和播放这些源。`
            : `确定要将选中的 ${keys.length} 个视频源对所有用户开放吗？`;
          actionName = `设置为${scopeLabel}`;
          successMessage = `已将 ${keys.length} 个视频源设为「${scopeLabel}」`;
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
          try {
            await withLoading(loadingKey, () => callSourceApi(body));
            showToast(successMessage, 'success');
            onClearSelection();
          } catch (err) {
            showAlert({
              type: 'error',
              title: `${actionName}失败`,
              message: err instanceof Error ? err.message : '操作失败',
            });
          }
          closeConfirmModal();
        },
        onCancel: closeConfirmModal,
      });
    },
    [
      selectedSources,
      callSourceApi,
      withLoading,
      showAlert,
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
