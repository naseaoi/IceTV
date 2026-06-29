'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useCallback, useEffect, useMemo, useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import AlertModal from '@/features/admin/components/AlertModal';
import { SortableSourceRow } from '@/features/admin/components/tabs/video-source/SortableSourceRow';
import { SourceValidationModal } from '@/features/admin/components/tabs/video-source/SourceValidationModal';
import { VideoSourceAddForm } from '@/features/admin/components/tabs/video-source/VideoSourceAddForm';
import { VideoSourceEditForm } from '@/features/admin/components/tabs/video-source/VideoSourceEditForm';
import { useAdminSourceActions } from '@/features/admin/hooks/useAdminSourceActions';
import { useAlertModal } from '@/features/admin/hooks/useAlertModal';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { useSourceBatchOperation } from '@/features/admin/hooks/useSourceBatchOperation';
import { useSourceValidation } from '@/features/admin/hooks/useSourceValidation';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { showError } from '@/features/admin/lib/notifications';
import { AdminConfig } from '@/features/admin/types/api';
import { DataSource } from '@/features/admin/types/internal';
import { useModalState } from '@/hooks/useModalState';

const VideoSourceConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const { runAction } = useAdminSourceActions({
    endpoint: '/api/admin/source',
    refreshConfig,
    showAlert,
  });
  const [sources, setSources] = useState<DataSource[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DataSource | null>(null);
  const [orderChanged, setOrderChanged] = useState(false);
  const [newSource, setNewSource] = useState<DataSource>({
    name: '',
    key: '',
    api: '',
    detail: '',
    disabled: false,
    from: 'config',
  });

  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set(),
  );

  const selectAll = useMemo(() => {
    return selectedSources.size === sources.length && selectedSources.size > 0;
  }, [selectedSources.size, sources.length]);

  const [showValidationModal, setShowValidationModal, openValidationModal] =
    useModalState(false);
  const [searchKeyword, setSearchKeyword] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 5,
      },
    }),
  );

  useEffect(() => {
    if (!config?.SourceConfig) return;
    const remote = config.SourceConfig;

    setSources((prev) => {
      if (prev.length === 0) {
        setOrderChanged(false);
        return remote;
      }

      const remoteMap = new Map(remote.map((s) => [s.key, s]));
      const remoteKeys = new Set(remote.map((s) => s.key));

      const merged = prev
        .filter((s) => remoteKeys.has(s.key))
        .map((s) => remoteMap.get(s.key)!);

      const localKeys = new Set(prev.map((s) => s.key));
      remote.forEach((s) => {
        if (!localKeys.has(s.key)) merged.push(s);
      });

      return merged;
    });

    setSelectedSources(new Set());
  }, [config]);

  const callSourceApi = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        await runAction({ ...body });
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    },
    [runAction, showAlert],
  );

  const handleToggleEnable = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    withLoading(`toggleSource_${key}`, () =>
      callSourceApi({ action, key }),
    ).catch(() => void 0);
  };

  const handleToggleProxyMode = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const newMode = target.proxyMode === 'server' ? 'browser' : 'server';
    withLoading(`proxyMode_${key}`, () =>
      callSourceApi({ action: 'set_proxy_mode', key, proxyMode: newMode }),
    ).catch(() => void 0);
  };

  const handleDelete = (key: string) => {
    const target = sources.find((source) => source.key === key);
    if (!target) return;
    setDeleteTarget(target);
  };

  const handleConfirmDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    withLoading(`deleteSource_${target.key}`, () =>
      callSourceApi({ action: 'delete', key: target.key }),
    ).catch(() => void 0);
  };

  const handleAddSource = () => {
    if (!newSource.name || !newSource.key || !newSource.api) return;
    withLoading('addSource', async () => {
      await callSourceApi({
        action: 'add',
        key: newSource.key,
        name: newSource.name,
        api: newSource.api,
        detail: newSource.detail,
      });
      setNewSource({
        name: '',
        key: '',
        api: '',
        detail: '',
        disabled: false,
        from: 'custom',
      });
      setShowAddForm(false);
    }).catch(() => void 0);
  };

  const handleEditSource = () => {
    if (!editingSource || !editingSource.name || !editingSource.api) return;
    withLoading('editSource', async () => {
      await callSourceApi({
        action: 'edit',
        key: editingSource.key,
        name: editingSource.name,
        api: editingSource.api,
        detail: editingSource.detail || '',
      });
      setEditingSource(null);
    }).catch(() => void 0);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sources.findIndex((s) => s.key === active.id);
    const newIndex = sources.findIndex((s) => s.key === over.id);
    setSources((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = sources.map((s) => s.key);
    withLoading('saveSourceOrder', () =>
      callSourceApi({ action: 'sort', order }),
    )
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => void 0);
  };

  const { isValidating, startValidation, getValidationStatus } =
    useSourceValidation({ sources, showAlert });

  const handleStartValidation = async () => {
    setShowValidationModal(false);
    await withLoading('validateSources', async () => {
      await startValidation(searchKeyword);
    });
  };

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        const allKeys = sources.map((s) => s.key);
        setSelectedSources(new Set(allKeys));
      } else {
        setSelectedSources(new Set());
      }
    },
    [sources],
  );

  const handleSelectSource = useCallback((key: string, checked: boolean) => {
    setSelectedSources((prev) => {
      const newSelected = new Set(prev);
      if (checked) {
        newSelected.add(key);
      } else {
        newSelected.delete(key);
      }
      return newSelected;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedSources(new Set()), []);

  const { confirmModal, requestBatchOperation } = useSourceBatchOperation({
    selectedSources,
    onClearSelection: clearSelection,
    callSourceApi,
    withLoading,
    showAlert,
  });

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  const isAnyBatchLoading =
    isLoading('batchSource_batch_enable') ||
    isLoading('batchSource_batch_disable') ||
    isLoading('batchSource_batch_delete');

  return (
    <div className='space-y-6'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          视频源列表
        </h4>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2'>
          <div
            className={`${selectedSources.size > 0 ? '' : 'invisible'} contents`}
          >
            <div className='order-2 flex flex-wrap items-center gap-3 sm:order-1'>
              <span className='text-sm text-gray-600 dark:text-gray-400'>
                <span className='sm:hidden'>已选 {selectedSources.size}</span>
                <span className='hidden sm:inline'>
                  已选择 {selectedSources.size} 个视频源
                </span>
              </span>
              <button
                onClick={() => requestBatchOperation('batch_enable')}
                disabled={isLoading('batchSource_batch_enable')}
                className={`px-3 py-1 text-sm ${
                  isLoading('batchSource_batch_enable')
                    ? buttonStyles.disabled
                    : buttonStyles.success
                }`}
              >
                {isLoading('batchSource_batch_enable')
                  ? '启用中...'
                  : '批量启用'}
              </button>
              <button
                onClick={() => requestBatchOperation('batch_disable')}
                disabled={isLoading('batchSource_batch_disable')}
                className={`px-3 py-1 text-sm ${
                  isLoading('batchSource_batch_disable')
                    ? buttonStyles.disabled
                    : buttonStyles.warning
                }`}
              >
                {isLoading('batchSource_batch_disable')
                  ? '禁用中...'
                  : '批量禁用'}
              </button>
              <button
                onClick={() => requestBatchOperation('batch_delete')}
                disabled={isLoading('batchSource_batch_delete')}
                className={`px-3 py-1 text-sm ${
                  isLoading('batchSource_batch_delete')
                    ? buttonStyles.disabled
                    : buttonStyles.danger
                }`}
              >
                {isLoading('batchSource_batch_delete')
                  ? '删除中...'
                  : '批量删除'}
              </button>
            </div>
            <div className='order-2 hidden h-6 w-px bg-gray-300 dark:bg-gray-600 sm:block'></div>
          </div>
          <div className='order-1 flex items-center gap-2 sm:order-2'>
            <button
              onClick={openValidationModal}
              disabled={isValidating}
              className={`flex items-center space-x-1 rounded-lg px-3 py-1 text-sm transition-colors ${
                isValidating ? buttonStyles.disabled : buttonStyles.primary
              }`}
            >
              {isValidating ? (
                <>
                  <div className='h-3 w-3 animate-spin rounded-full border border-white border-t-transparent'></div>
                  <span>检测中...</span>
                </>
              ) : (
                '有效性检测'
              )}
            </button>
            <button
              onClick={() => {
                setShowAddForm(!showAddForm);
                setEditingSource(null);
              }}
              className={
                showAddForm ? buttonStyles.secondary : buttonStyles.success
              }
            >
              {showAddForm ? '取消' : '添加视频源'}
            </button>
          </div>
        </div>
      </div>

      {showAddForm && (
        <VideoSourceAddForm
          newSource={newSource}
          onChange={setNewSource}
          onSubmit={handleAddSource}
          isSubmitting={isLoading('addSource')}
        />
      )}

      {editingSource && (
        <VideoSourceEditForm
          editingSource={editingSource}
          onChange={setEditingSource}
          onSubmit={handleEditSource}
          onCancel={() => setEditingSource(null)}
          isSubmitting={isLoading('editSource')}
        />
      )}

      <div
        className='relative max-h-[28rem] overflow-x-auto overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700'
        data-table='source-list'
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={true}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='sticky top-0 z-10 bg-gray-50 dark:bg-gray-900'>
              <tr>
                <th className='w-8' />
                <th className='w-12 px-2 py-3 text-center'>
                  <input
                    type='checkbox'
                    checked={selectAll}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className='h-4 w-4 rounded border-gray-300 bg-gray-100 text-blue-600 accent-blue-600 checked:border-blue-600 checked:bg-blue-600 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:accent-blue-500 dark:ring-offset-gray-800 dark:checked:border-blue-500 dark:checked:bg-blue-500 dark:focus:ring-blue-600'
                  />
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                  名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                  Key
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                  API 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                  Detail 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                  状态
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                  流量路由
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                  有效性
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                  操作
                </th>
              </tr>
            </thead>
            <SortableContext
              items={sources.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {sources.map((source) => (
                  <SortableSourceRow
                    key={source.key}
                    source={source}
                    isSelected={selectedSources.has(source.key)}
                    validationStatus={getValidationStatus(source.key)}
                    isProxyModeLoading={isLoading(`proxyMode_${source.key}`)}
                    isToggleLoading={isLoading(`toggleSource_${source.key}`)}
                    isDeleteLoading={isLoading(`deleteSource_${source.key}`)}
                    onSelectSource={handleSelectSource}
                    onToggleProxyMode={handleToggleProxyMode}
                    onToggleEnable={handleToggleEnable}
                    onEdit={(source) => {
                      setEditingSource(source);
                      setShowAddForm(false);
                    }}
                    onDelete={handleDelete}
                  />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>

      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            disabled={isLoading('saveSourceOrder')}
            className={`px-3 py-1.5 text-sm ${
              isLoading('saveSourceOrder')
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            {isLoading('saveSourceOrder') ? '保存中...' : '保存排序'}
          </button>
        </div>
      )}

      <SourceValidationModal
        isOpen={showValidationModal}
        searchKeyword={searchKeyword}
        onSearchKeywordChange={setSearchKeyword}
        onClose={() => setShowValidationModal(false)}
        onStart={handleStartValidation}
      />

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        onClose={confirmModal.onCancel}
        onConfirm={confirmModal.onConfirm}
        confirmText={isAnyBatchLoading ? '操作中...' : '确认'}
        confirmDisabled={isAnyBatchLoading}
        cancelClassName={`px-4 py-2 text-sm font-medium ${buttonStyles.secondary}`}
        confirmClassName={`px-4 py-2 text-sm font-medium ${
          isAnyBatchLoading ? buttonStyles.disabled : buttonStyles.primary
        }`}
        containerClassName='max-w-md'
      >
        <p className='text-sm text-gray-600 dark:text-gray-400'>
          {confirmModal.message}
        </p>
      </ConfirmModal>

      <ConfirmModal
        isOpen={!!deleteTarget}
        title='确认删除视频源'
        message={
          deleteTarget
            ? `确定要删除视频源「${deleteTarget.name}」吗？`
            : undefined
        }
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        confirmText='删除'
        danger
      />
    </div>
  );
};

export default VideoSourceConfig;
