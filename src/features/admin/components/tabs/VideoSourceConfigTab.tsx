'use client';

import {
  type DragEndEvent,
  closestCenter,
  DndContext,
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

import AlertModal from '@/components/modals/AlertModal';
import ConfirmModal from '@/components/modals/ConfirmModal';
import Select from '@/components/Select';
import AdminSearchField from '@/features/admin/components/AdminSearchField';
import { BatchSourceMenu } from '@/features/admin/components/tabs/video-source/BatchSourceMenu';
import {
  type RouteModeStats,
  type SourceRouteStatsView,
  SortableSourceRow,
} from '@/features/admin/components/tabs/video-source/SortableSourceRow';
import {
  isSourceCleanupCandidate,
  sortByHealth,
} from '@/features/admin/components/tabs/video-source/sourceHealthView';
import { SourceValidationModal } from '@/features/admin/components/tabs/video-source/SourceValidationModal';
import { VideoSourceAddForm } from '@/features/admin/components/tabs/video-source/VideoSourceAddForm';
import { VideoSourceEditForm } from '@/features/admin/components/tabs/video-source/VideoSourceEditForm';
import { useAdminSourceActions } from '@/features/admin/hooks/useAdminSourceActions';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { useSourceBatchOperation } from '@/features/admin/hooks/useSourceBatchOperation';
import {
  SOURCE_INSIGHT_DAYS,
  useSourceInsights,
} from '@/features/admin/hooks/useSourceInsights';
import { useSourceValidation } from '@/features/admin/hooks/useSourceValidation';
import {
  buttonStyles,
  checkboxStyles,
} from '@/features/admin/lib/buttonStyles';
import { showError } from '@/features/admin/lib/notifications';
import { DataSource } from '@/features/admin/types/internal';
import { useAlertModal } from '@/hooks/useAlertModal';
import { useModalState } from '@/hooks/useModalState';
import {
  type SourceProxyMode,
  DEFAULT_SOURCE_PROXY_MODE,
} from '@/lib/proxy-modes';
import type { SourceRouteStatsItem } from '@/lib/types';
import { AdminConfig } from '@/types/admin';

type SourceRouteStatsBySource = Record<string, SourceRouteStatsView>;
type SourceHealthFilter = 'all' | 'cleanup' | 'relay';

function isSourceHealthFilter(value: string): value is SourceHealthFilter {
  return value === 'all' || value === 'cleanup' || value === 'relay';
}
type SourceSortMode = 'manual' | 'quality';

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
  const {
    routeStats,
    capabilities: routeCapabilities,
    health: sourceHealth,
  } = useSourceInsights(config, Boolean(config?.SourceConfig));
  const sourceRouteStats = useMemo(
    () => buildSourceRouteStats(routeStats),
    [routeStats],
  );
  const [filterQuery, setFilterQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState<SourceHealthFilter>('all');
  const [sortMode, setSortMode] = useState<SourceSortMode>('manual');
  const normalizedQuery = filterQuery.trim().toLowerCase();
  const isFiltering = normalizedQuery.length > 0 || healthFilter !== 'all';
  const isSortingLocked = isFiltering || sortMode !== 'manual';
  const cleanupCount = useMemo(
    () =>
      sources.filter((item) =>
        isSourceCleanupCandidate(sourceHealth.get(item.key)),
      ).length,
    [sources, sourceHealth],
  );
  const isRelaySource = useCallback(
    (key: string) => routeCapabilities[key]?.direct === 'blocked',
    [routeCapabilities],
  );
  const relayCount = useMemo(
    () => sources.filter((item) => isRelaySource(item.key)).length,
    [sources, isRelaySource],
  );
  const visibleRows = useMemo(() => {
    const matched = sources.filter(
      (item) =>
        (healthFilter === 'all' ||
          (healthFilter === 'cleanup'
            ? isSourceCleanupCandidate(sourceHealth.get(item.key))
            : isRelaySource(item.key))) &&
        [item.name, item.key, item.api, item.detail].some((value) =>
          value?.toLowerCase().includes(normalizedQuery),
        ),
    );
    return sortMode === 'quality'
      ? sortByHealth(matched, sourceHealth)
      : matched;
  }, [
    sources,
    sourceHealth,
    healthFilter,
    isRelaySource,
    sortMode,
    normalizedQuery,
  ]);
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

  const selectAll =
    visibleRows.length > 0 &&
    visibleRows.every((source) => selectedSources.has(source.key));

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

  const handleChangeProxyMode = (key: string, proxyMode: SourceProxyMode) => {
    const target = sources.find((s) => s.key === key);
    if (
      !target ||
      (target.proxyMode || DEFAULT_SOURCE_PROXY_MODE) === proxyMode
    ) {
      return;
    }
    withLoading(`proxyMode_${key}`, () =>
      callSourceApi({ action: 'set_proxy_mode', key, proxyMode }),
    ).catch(() => void 0);
  };

  const handleToggleAdminOnly = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    withLoading(`adminOnly_${key}`, () =>
      callSourceApi({
        action: 'set_admin_only',
        key,
        adminOnly: !target.adminOnly,
      }),
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
    if (isSortingLocked || !over || active.id === over.id) return;
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
      setSelectedSources((previous) => {
        const next = new Set(previous);
        visibleRows.forEach((source) => {
          if (checked) next.add(source.key);
          else next.delete(source.key);
        });
        return next;
      });
    },
    [visibleRows],
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
    isLoading('batchSource_batch_set_proxy_mode_auto') ||
    isLoading('batchSource_batch_set_admin_only_on') ||
    isLoading('batchSource_batch_set_admin_only_off');

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between gap-3'>
        <AdminSearchField
          value={filterQuery}
          onChange={setFilterQuery}
          label='搜索视频源'
          className='min-w-0 flex-1 sm:w-72 sm:flex-none'
        />
        <div className='flex shrink-0 items-center gap-2'>
          <Select
            variant='pill'
            align='end'
            value={healthFilter}
            onChange={(value) =>
              setHealthFilter(isSourceHealthFilter(value) ? value : 'all')
            }
            options={[
              { value: 'all', label: '全部' },
              { value: 'cleanup', label: `待清理 ${cleanupCount}` },
              { value: 'relay', label: `需中转 ${relayCount}` },
            ]}
            showSelectedIcon={false}
            ariaLabel='按源站质量筛选'
          />
          <Select
            variant='pill'
            align='end'
            value={sortMode}
            onChange={(value) =>
              setSortMode(value === 'quality' ? 'quality' : 'manual')
            }
            options={[
              { value: 'manual', label: '手动排序' },
              { value: 'quality', label: '质量排序' },
            ]}
            showSelectedIcon={false}
            ariaLabel='视频源排序方式'
          />
          <button
            onClick={() => {
              setShowAddForm(true);
              setEditingSource(null);
            }}
            className={buttonStyles.primary}
          >
            添加视频源
          </button>
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
        className='overflow-hidden rounded-xl ring-1 ring-gray-200 dark:ring-white/[0.06] [&:has([role=listbox])]:overflow-visible [&:has([role=menu])]:overflow-visible'
        data-list='source-list'
      >
        <div className='flex h-10 items-center gap-3 rounded-t-xl bg-gray-50 px-3 text-xs text-gray-500 dark:bg-white/[0.03] dark:text-gray-400'>
          <input
            type='checkbox'
            aria-label='全选当前视频源'
            disabled={visibleRows.length === 0}
            checked={selectAll}
            onChange={(e) => handleSelectAll(e.target.checked)}
            className={checkboxStyles}
          />
          <span className='tabular-nums'>
            {selectedSources.size > 0
              ? `已选 ${selectedSources.size} 个`
              : `共 ${visibleRows.length} 个`}
          </span>
          <div className='ml-auto'>
            {selectedSources.size > 0 && (
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
                isAdminOnlyLoading={isLoading(
                  'batchSource_batch_set_admin_only_on',
                )}
                isPublicLoading={isLoading(
                  'batchSource_batch_set_admin_only_off',
                )}
                onEnable={() => requestBatchOperation('batch_enable')}
                onDisable={() => requestBatchOperation('batch_disable')}
                onDelete={() => requestBatchOperation('batch_delete')}
                onValidate={handleBatchValidation}
                onSetProxyMode={(proxyMode) =>
                  requestBatchOperation('batch_set_proxy_mode', { proxyMode })
                }
                onSetAdminOnly={(adminOnly) =>
                  requestBatchOperation('batch_set_admin_only', { adminOnly })
                }
              />
            )}
          </div>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={true}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <SortableContext
            items={visibleRows.map((s) => s.key)}
            strategy={verticalListSortingStrategy}
          >
            <ul
              aria-label='视频源列表'
              className='divide-y divide-gray-200 dark:divide-white/[0.06]'
            >
              {visibleRows.length === 0 && (
                <li className='rounded-b-xl bg-white px-6 py-12 text-center text-sm text-gray-500 dark:bg-gray-900 dark:text-gray-400'>
                  {healthFilter === 'cleanup' && !normalizedQuery
                    ? '没有待清理的视频源'
                    : healthFilter === 'relay' && !normalizedQuery
                      ? '没有需中转的视频源'
                      : isFiltering
                        ? '没有匹配的视频源'
                        : '暂无视频源'}
                </li>
              )}
              {visibleRows.map((source) => (
                <SortableSourceRow
                  isSortingDisabled={isSortingLocked}
                  key={source.key}
                  source={source}
                  isSelected={selectedSources.has(source.key)}
                  validationStatus={getValidationStatus(source.key)}
                  sourceRouteStats={sourceRouteStats[source.key] || null}
                  routeCapability={routeCapabilities[source.key] || null}
                  sourceHealth={sourceHealth.get(source.key) || null}
                  healthDays={SOURCE_INSIGHT_DAYS}
                  isProxyModeLoading={isLoading(`proxyMode_${source.key}`)}
                  isToggleLoading={isLoading(`toggleSource_${source.key}`)}
                  isAdminOnlyLoading={isLoading(`adminOnly_${source.key}`)}
                  isDeleteLoading={isLoading(`deleteSource_${source.key}`)}
                  isValidationLoading={isValidating}
                  onSelectSource={handleSelectSource}
                  onChangeProxyMode={handleChangeProxyMode}
                  onToggleEnable={handleToggleEnable}
                  onToggleAdminOnly={handleToggleAdminOnly}
                  onValidate={handleValidateSource}
                  onEdit={(source) => {
                    setEditingSource(source);
                    setShowAddForm(false);
                  }}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          </SortableContext>
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
