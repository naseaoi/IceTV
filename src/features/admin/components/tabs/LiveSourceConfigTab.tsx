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
import { useEffect, useMemo, useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import AdminSearchField from '@/features/admin/components/AdminSearchField';
import { LiveSourceAddForm } from '@/features/admin/components/tabs/live-source/LiveSourceAddForm';
import { LiveSourceEditForm } from '@/features/admin/components/tabs/live-source/LiveSourceEditForm';
import { SortableLiveSourceRow } from '@/features/admin/components/tabs/live-source/SortableLiveSourceRow';
import { useAdminSourceActions } from '@/features/admin/hooks/useAdminSourceActions';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { adminPost } from '@/features/admin/lib/api';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { showError } from '@/features/admin/lib/notifications';
import { LiveDataSource } from '@/features/admin/types/internal';
import { showToast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/user-facing-error';
import { AdminConfig } from '@/types/admin';

const LiveSourceConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const { isLoading, withLoading } = useLoadingState();
  const { runAction } = useAdminSourceActions({
    endpoint: '/api/admin/live',
    refreshConfig,
  });
  const [liveSources, setLiveSources] = useState<LiveDataSource[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const normalizedQuery = filterQuery.trim().toLowerCase();
  const isFiltering = normalizedQuery.length > 0;
  const visibleRows = useMemo(
    () =>
      liveSources.filter((item) =>
        [item.name, item.key, item.url].some((value) =>
          value?.toLowerCase().includes(normalizedQuery),
        ),
      ),
    [liveSources, normalizedQuery],
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingLiveSource, setEditingLiveSource] =
    useState<LiveDataSource | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LiveDataSource | null>(null);
  const [orderChanged, setOrderChanged] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newLiveSource, setNewLiveSource] = useState<LiveDataSource>({
    name: '',
    key: '',
    url: '',
    ua: '',
    epg: '',
    disabled: false,
    from: 'custom',
  });

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
    if (config?.LiveConfig) {
      setLiveSources(config.LiveConfig);
      setOrderChanged(false);
    }
  }, [config]);

  const callLiveSourceApi = async (body: Record<string, unknown>) => {
    setActionError('');
    await runAction({ ...body });
  };

  const handleToggleEnable = (key: string) => {
    const target = liveSources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    withLoading(`toggleLiveSource_${key}`, () =>
      callLiveSourceApi({ action, key }),
    ).catch((error) => setActionError(getErrorMessage(error, '操作失败')));
  };

  const handleDelete = (key: string) => {
    const target = liveSources.find((source) => source.key === key);
    if (!target) return;
    setDeleteTarget(target);
  };

  const handleConfirmDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    withLoading(`deleteLiveSource_${target.key}`, () =>
      callLiveSourceApi({ action: 'delete', key: target.key }),
    ).catch((error) => setActionError(getErrorMessage(error, '操作失败')));
  };

  const handleRefreshLiveSources = async () => {
    if (isRefreshing) return;

    await withLoading('refreshLiveSources', async () => {
      setIsRefreshing(true);
      try {
        const result = await adminPost<{
          refreshed: number;
          failed: { key: string; name: string }[];
          liveDisabled?: boolean;
        }>('/api/admin/live/refresh', {}, '刷新失败');
        await refreshConfig();
        if (result.liveDisabled) {
          showToast('直播未开启，已跳过刷新', 'info');
        } else if (result.failed.length > 0) {
          showToast(
            `已刷新 ${result.refreshed} 个直播源，${result.failed.length} 个失败：${result.failed.map((source) => source.name).join('、')}`,
            'error',
          );
        } else {
          showToast('直播源已刷新', 'success');
        }
      } catch (err) {
        showError(err, '刷新失败');
      } finally {
        setIsRefreshing(false);
      }
    });
  };

  const handleAddLiveSource = () => {
    if (!newLiveSource.name || !newLiveSource.key || !newLiveSource.url) return;
    setFormError('');
    withLoading('addLiveSource', async () => {
      await callLiveSourceApi({
        action: 'add',
        key: newLiveSource.key,
        name: newLiveSource.name,
        url: newLiveSource.url,
        ua: newLiveSource.ua,
        epg: newLiveSource.epg,
      });
      setNewLiveSource({
        name: '',
        key: '',
        url: '',
        epg: '',
        ua: '',
        disabled: false,
        from: 'custom',
      });
      setShowAddForm(false);
    }).catch((error) => setFormError(getErrorMessage(error, '操作失败')));
  };

  const handleEditLiveSource = () => {
    if (!editingLiveSource || !editingLiveSource.name || !editingLiveSource.url)
      return;
    setFormError('');
    withLoading('editLiveSource', async () => {
      await callLiveSourceApi({
        action: 'edit',
        key: editingLiveSource.key,
        name: editingLiveSource.name,
        url: editingLiveSource.url,
        ua: editingLiveSource.ua,
        epg: editingLiveSource.epg,
      });
      setEditingLiveSource(null);
    }).catch((error) => setFormError(getErrorMessage(error, '操作失败')));
  };

  const handleCancelEdit = () => {
    setEditingLiveSource(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (
      isLoading('saveLiveSourceOrder') ||
      isFiltering ||
      !over ||
      active.id === over.id
    )
      return;
    const oldIndex = liveSources.findIndex((s) => s.key === active.id);
    const newIndex = liveSources.findIndex((s) => s.key === over.id);
    setLiveSources((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = liveSources.map((s) => s.key);
    withLoading('saveLiveSourceOrder', () =>
      callLiveSourceApi({ action: 'sort', order }),
    )
      .then(() => {
        setOrderChanged(false);
      })
      .catch((error) => setActionError(getErrorMessage(error, '操作失败')));
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {actionError && (
        <p role='alert' className='text-sm text-red-600'>
          {actionError}
        </p>
      )}
      <div className='flex items-center justify-between gap-3'>
        <AdminSearchField
          value={filterQuery}
          onChange={setFilterQuery}
          label='搜索直播源'
          className='min-w-0 flex-1 sm:w-72 sm:flex-none'
        />
        <div className='flex shrink-0 items-center gap-2'>
          <button
            onClick={() => {
              setFormError('');
              setShowAddForm(true);
              setEditingLiveSource(null);
            }}
            className={buttonStyles.primary}
          >
            添加直播源
          </button>
        </div>
      </div>

      <LiveSourceAddForm
        error={formError}
        newLiveSource={newLiveSource}
        isOpen={showAddForm}
        onChange={setNewLiveSource}
        onSubmit={handleAddLiveSource}
        onCancel={() => setShowAddForm(false)}
        isSubmitting={isLoading('addLiveSource')}
      />

      <LiveSourceEditForm
        error={formError}
        editingLiveSource={editingLiveSource}
        isOpen={!!editingLiveSource}
        onChange={setEditingLiveSource}
        onSubmit={handleEditLiveSource}
        onCancel={handleCancelEdit}
        isSubmitting={isLoading('editLiveSource')}
      />

      <div
        className='overflow-hidden rounded-xl ring-1 ring-gray-200 dark:ring-white/[0.06] [&:has([role=listbox])]:overflow-visible [&:has([role=menu])]:overflow-visible'
        data-list='live-source-list'
      >
        <div className='flex h-10 items-center gap-3 rounded-t-xl bg-gray-50 px-3 text-xs text-gray-500 dark:bg-white/[0.03] dark:text-gray-400'>
          <span className='tabular-nums'>{`共 ${visibleRows.length} 个`}</span>
          <button
            onClick={handleRefreshLiveSources}
            disabled={isRefreshing || isLoading('refreshLiveSources')}
            className={`ml-auto ${buttonStyles.outline}`}
          >
            {isRefreshing || isLoading('refreshLiveSources')
              ? '刷新中...'
              : '刷新直播源'}
          </button>
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
              aria-label='直播源列表'
              className='divide-y divide-gray-200 dark:divide-white/[0.06]'
            >
              {visibleRows.length === 0 && (
                <li className='rounded-b-xl bg-white px-6 py-12 text-center text-sm text-gray-500 dark:bg-gray-900 dark:text-gray-400'>
                  {isFiltering ? '没有匹配的直播源' : '暂无直播源'}
                </li>
              )}
              {visibleRows.map((liveSource) => (
                <SortableLiveSourceRow
                  isSortingDisabled={
                    isFiltering || isLoading('saveLiveSourceOrder')
                  }
                  key={liveSource.key}
                  liveSource={liveSource}
                  isToggleLoading={isLoading(
                    `toggleLiveSource_${liveSource.key}`,
                  )}
                  isEditLoading={isLoading('editLiveSource')}
                  isDeleteLoading={isLoading(
                    `deleteLiveSource_${liveSource.key}`,
                  )}
                  onToggleEnable={handleToggleEnable}
                  onEdit={setEditingLiveSource}
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
            disabled={isLoading('saveLiveSourceOrder')}
            className={`px-3 py-1.5 text-sm ${
              isLoading('saveLiveSourceOrder')
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            {isLoading('saveLiveSourceOrder') ? '保存中...' : '保存排序'}
          </button>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteTarget}
        title='确认删除直播源'
        message={
          deleteTarget
            ? `确定要删除直播源「${deleteTarget.name}」吗？`
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

export default LiveSourceConfig;
