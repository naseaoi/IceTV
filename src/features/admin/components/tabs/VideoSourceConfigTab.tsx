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
import AlertModal from '@/components/modals/AlertModal';
import {
  type RouteModeStats,
  SortableSourceRow,
  type SourceRouteStatsView,
} from '@/features/admin/components/tabs/video-source/SortableSourceRow';
import { BatchSourceMenu } from '@/features/admin/components/tabs/video-source/BatchSourceMenu';
import { SourceValidationModal } from '@/features/admin/components/tabs/video-source/SourceValidationModal';
import { VideoSourceAddForm } from '@/features/admin/components/tabs/video-source/VideoSourceAddForm';
import { VideoSourceEditForm } from '@/features/admin/components/tabs/video-source/VideoSourceEditForm';
import { useAdminSourceActions } from '@/features/admin/hooks/useAdminSourceActions';
import { useAlertModal } from '@/hooks/useAlertModal';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { useSourceBatchOperation } from '@/features/admin/hooks/useSourceBatchOperation';
import { useSourceValidation } from '@/features/admin/hooks/useSourceValidation';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { adminGet } from '@/features/admin/lib/api';
import { showError } from '@/features/admin/lib/notifications';
import { AdminConfig } from '@/types/admin';
import { DataSource } from '@/features/admin/types/internal';
import { useModalState } from '@/hooks/useModalState';
import type { SourceRouteStatsItem } from '@/lib/types';

type SourceRouteStatsBySource = Record<string, SourceRouteStatsView>;

function toRouteModeStats(item: SourceRouteStatsItem): RouteModeStats {
  const totalCount = item.successCount + item.failureCount;
  return {
    successCount: item.successCount,
    failureCount: item.failureCount,
    totalCount,
    successRate: totalCount > 0 ? item.successCount / totalCount : null,
  };
}

function buildSourceRouteStats(
  items: SourceRouteStatsItem[],
): SourceRouteStatsBySource {
  return items.reduce<SourceRouteStatsBySource>((acc, item) => {
    const current = acc[item.source] || {};
    current[item.routeMode] = toRouteModeStats(item);
    acc[item.source] = current;
    return acc;
  }, {});
}

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
  const [sourceRouteStats, setSourceRouteStats] =
    useState<SourceRouteStatsBySource>({});
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
  const [pendingValidationSourceKeys, setPendingValidationSourceKeys] =
    useState<string[] | null>(null);

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

  useEffect(() => {
    if (!config?.SourceConfig) return;
    let cancelled = false;
    adminGet<{ stats: SourceRouteStatsItem[] }>(
      '/api/admin/source-route-stats?days=7',
      '读取路由统计失败',
    )
      .then((payload) => {
        if (cancelled) return;
        setSourceRouteStats(buildSourceRouteStats(payload.stats || []));
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('读取路由统计失败:', error);
        setSourceRouteStats({});
      });

    return () => {
      cancelled = true;
    };
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
    const currentMode = target.proxyMode || 'browser';
    const newMode =
      currentMode === 'browser'
        ? 'server'
        : currentMode === 'server'
          ? 'auto'
          : 'browser';
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

  const handleOpenValidationModal = (sourceKeys?: string[]) => {
    setSearchKeyword('');
    setPendingValidationSourceKeys(sourceKeys || null);
    openValidationModal();
  };

  const handleCloseValidationModal = () => {
    setShowValidationModal(false);
    setSearchKeyword('');
    setPendingValidationSourceKeys(null);
  };

  const handleStartValidation = async () => {
    const keyword = searchKeyword;
    setShowValidationModal(false);
    setSearchKeyword('');
    const sourceKeys = pendingValidationSourceKeys || undefined;
    setPendingValidationSourceKeys(null);
    await withLoading('validateSources', async () => {
      await startValidation(keyword, sourceKeys);
    });
  };

  const handleValidateSource = (key: string) => {
    handleOpenValidationModal([key]);
  };

  const handleBatchValidation = () => {
    if (selectedSources.size === 0) {
      showAlert({
        type: 'warning',
        title: '请先选择要检测的视频源',
        message: '请选择至少一个视频源',
      });
      return;
    }
    handleOpenValidationModal(Array.from(selectedSources));
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
    isLoading('batchSource_batch_delete') ||
    isLoading('batchSource_batch_set_proxy_mode_browser') ||
    isLoading('batchSource_batch_set_proxy_mode_server') ||
    isLoading('batchSource_batch_set_proxy_mode_auto');

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
              <BatchSourceMenu
                selectedCount={selectedSources.size}
                isEnableLoading={isLoading('batchSource_batch_enable')}
                isDisableLoading={isLoading('batchSource_batch_disable')}
                isDeleteLoading={isLoading('batchSource_batch_delete')}
                isValidationLoading={isValidating}
                isBrowserRouteLoading={isLoading(
                  'batchSource_batch_set_proxy_mode_browser',
                )}
                isServerRouteLoading={isLoading(
                  'batchSource_batch_set_proxy_mode_server',
                )}
                isAutoRouteLoading={isLoading(
                  'batchSource_batch_set_proxy_mode_auto',
                )}
                onEnable={() => requestBatchOperation('batch_enable')}
                onDisable={() => requestBatchOperation('batch_disable')}
                onDelete={() => requestBatchOperation('batch_delete')}
                onValidate={handleBatchValidation}
                onSetProxyMode={(proxyMode) =>
                  requestBatchOperation('batch_set_proxy_mode', { proxyMode })
                }
              />
            </div>
            <div className='order-2 hidden h-6 w-px bg-gray-300 dark:bg-gray-600 sm:block'></div>
          </div>
          <div className='order-1 flex items-center gap-2 sm:order-2'>
            <button
              onClick={() => {
                setShowAddForm(true);
                setEditingSource(null);
              }}
              className={buttonStyles.success}
            >
              添加视频源
            </button>
          </div>
        </div>
      </div>

      <VideoSourceAddForm
        newSource={newSource}
        isOpen={showAddForm}
        onChange={setNewSource}
        onSubmit={handleAddSource}
        onCancel={() => setShowAddForm(false)}
        isSubmitting={isLoading('addSource')}
      />

      <VideoSourceEditForm
        editingSource={editingSource}
        isOpen={!!editingSource}
        onChange={setEditingSource}
        onSubmit={handleEditSource}
        onCancel={() => setEditingSource(null)}
        isSubmitting={isLoading('editSource')}
      />

      <div
        className='relative overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700'
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
                  7天成功率
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
                    sourceRouteStats={sourceRouteStats[source.key] || null}
                    isProxyModeLoading={isLoading(`proxyMode_${source.key}`)}
                    isToggleLoading={isLoading(`toggleSource_${source.key}`)}
                    isDeleteLoading={isLoading(`deleteSource_${source.key}`)}
                    isValidationLoading={isValidating}
                    onSelectSource={handleSelectSource}
                    onToggleProxyMode={handleToggleProxyMode}
                    onToggleEnable={handleToggleEnable}
                    onValidate={handleValidateSource}
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
        onClose={handleCloseValidationModal}
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
