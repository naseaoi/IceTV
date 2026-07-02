'use client';

import { useCallback, useState } from 'react';

import { useAlertModal } from '@/hooks/useAlertModal';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';

type BatchAction = 'batch_enable' | 'batch_disable' | 'batch_delete';

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
    (action: BatchAction) => {
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

      switch (action) {
        case 'batch_enable':
          confirmMessage = `确定要启用选中的 ${keys.length} 个视频源吗？`;
          actionName = '批量启用';
          break;
        case 'batch_disable':
          confirmMessage = `确定要禁用选中的 ${keys.length} 个视频源吗？`;
          actionName = '批量禁用';
          break;
        case 'batch_delete':
          confirmMessage = `确定要删除选中的 ${keys.length} 个视频源吗？此操作不可恢复！`;
          actionName = '批量删除';
          break;
      }

      setConfirmModal({
        isOpen: true,
        title: '确认操作',
        message: confirmMessage,
        onConfirm: async () => {
          try {
            await withLoading(`batchSource_${action}`, () =>
              callSourceApi({ action, keys }),
            );
            showAlert({
              type: 'success',
              title: `${actionName}成功`,
              message: `${actionName}了 ${keys.length} 个视频源`,
              timer: 2000,
            });
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
