'use client';

import { Archive, BellOff, History } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  LIBRARY_DANGER_BUTTON_CLASS,
  LIBRARY_PILL_BUTTON_CLASS,
  LIBRARY_TOOLBAR_BUTTON_CLASS,
  LibraryEmptyState,
} from '@/components/LibraryPage';
import { LibraryFilterChip } from '@/components/LibraryToolbar';
import LoadErrorState from '@/components/LoadErrorState';
import ConfirmModal from '@/components/modals/ConfirmModal';
import {
  type ContinueWatchingCounts,
  useContinueWatchingItems,
} from '@/features/continue-watching/hooks/useContinueWatchingItems';
import {
  type ContinueWatchingFilter,
  CONTINUE_WATCHING_PAGE_SIZE,
  parseContinueWatchingFilter,
} from '@/features/continue-watching/lib/layout';
import { useInfiniteScroll } from '@/features/douban/hooks/useInfiniteScroll';
import { useRetainedValue } from '@/hooks/useRetainedValue';

import { ContinueWatchingGrid } from './ContinueWatchingGrid';
import {
  ContinueWatchingGridSkeleton,
  ContinueWatchingPageFrame,
  ContinueWatchingToolbarSkeleton,
} from './ContinueWatchingPageFrame';

// 筛选只改地址栏不走路由，避免重新请求服务端组件。state 传 null：带着 Next 内部
// 标记（__NA）的 state 会被当作路由自身调用而不同步，之后路由重渲染会把地址改回去
function replaceFilterInUrl(filter: ContinueWatchingFilter) {
  const url = new URL(window.location.href);
  if (filter === 'all') url.searchParams.delete('filter');
  else url.searchParams.set('filter', filter);
  window.history.replaceState(null, '', url);
}

export function ContinueWatchingPageClient({
  initialSkeletonCount = 0,
  initialCounts,
}: {
  initialSkeletonCount?: number;
  initialCounts?: ContinueWatchingCounts;
}) {
  // 筛选以地址栏为准：前进后退恢复的是缓存的页面参数，组件内状态会与地址不一致
  const filter = parseContinueWatchingFilter(useSearchParams()?.get('filter'));
  const {
    items,
    counts,
    loading,
    refreshing,
    loadingMore,
    error,
    retry,
    skeletonCount,
    hasMore,
    loadMore,
    removeItems,
    removeItem,
  } = useContinueWatchingItems({
    filter,
    initialSkeletonCount,
    initialCounts,
  });
  const [editing, setEditing] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 消息通知静音时追更未读数被置零，计数以筛选接口的结果为准
  const updatedCount = counts.updated;
  const showUpdatedChip = filter === 'updated' || (updatedCount ?? 0) > 0;
  const shelvedCount = counts.shelved;
  const showShelvedChip = filter === 'shelved' || (shelvedCount ?? 0) > 0;
  const allSelected = items.length > 0 && selectedKeys.size === items.length;
  // 删除完成后选中会被清空，弹窗退场期间仍显示删除前的条数
  const confirmCount = useRetainedValue(
    confirmOpen && selectedKeys.size > 0 ? selectedKeys.size : null,
  );

  const sentinelRef = useInfiniteScroll<HTMLDivElement>({
    enabled: hasMore && !error && !loading && !refreshing && !loadingMore,
    onLoadMore: () => void loadMore(),
  });

  // 删除或筛选后已不在列表里的条目不再算作选中
  useEffect(() => {
    setSelectedKeys((current) => {
      const visible = new Set(items.map((item) => item.key));
      const next = new Set([...current].filter((key) => visible.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const exitEditing = () => {
    setEditing(false);
    setSelectedKeys(new Set());
  };

  const changeFilter = (next: ContinueWatchingFilter) => {
    if (next === filter) return;
    exitEditing();
    replaceFilterInUrl(next);
  };

  const toggleSelected = (key: string) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const deleteSelected = async () => {
    await removeItems(Array.from(selectedKeys));
    setConfirmOpen(false);
    exitEditing();
  };

  const toolbar = editing ? (
    <>
      <span className='text-sm text-gray-500 dark:text-gray-400'>
        已选{' '}
        <span className='font-medium tabular-nums text-gray-900 dark:text-gray-100'>
          {selectedKeys.size}
        </span>{' '}
        项
      </span>
      <div className='ml-auto flex items-center gap-1'>
        <button
          type='button'
          onClick={() =>
            setSelectedKeys(
              allSelected ? new Set() : new Set(items.map((item) => item.key)),
            )
          }
          className={LIBRARY_TOOLBAR_BUTTON_CLASS}
        >
          {allSelected ? '取消全选' : '全选'}
        </button>
        <button
          type='button'
          disabled={selectedKeys.size === 0}
          onClick={() => setConfirmOpen(true)}
          className={LIBRARY_DANGER_BUTTON_CLASS}
        >
          删除
        </button>
        <button
          type='button'
          onClick={exitEditing}
          className={LIBRARY_TOOLBAR_BUTTON_CLASS}
        >
          完成
        </button>
      </div>
    </>
  ) : loading && items.length === 0 ? (
    <ContinueWatchingToolbarSkeleton count={skeletonCount} />
  ) : (
    <>
      <div
        role='group'
        aria-label='筛选'
        className='flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      >
        <LibraryFilterChip
          label='全部'
          count={counts.all ?? 0}
          loading={counts.all === null}
          active={filter === 'all'}
          onClick={() => changeFilter('all')}
        />
        {showUpdatedChip && (
          <LibraryFilterChip
            label='有更新'
            count={updatedCount ?? 0}
            loading={updatedCount === null}
            active={filter === 'updated'}
            onClick={() => changeFilter('updated')}
          />
        )}
        {showShelvedChip && (
          <LibraryFilterChip
            label='搁置中'
            count={shelvedCount ?? 0}
            loading={shelvedCount === null}
            active={filter === 'shelved'}
            onClick={() => changeFilter('shelved')}
          />
        )}
      </div>
      {items.length > 0 && (
        <button
          type='button'
          onClick={() => setEditing(true)}
          className={`${LIBRARY_TOOLBAR_BUTTON_CLASS} ml-auto`}
        >
          编辑
        </button>
      )}
    </>
  );

  let content: React.ReactNode;
  if (loading && items.length === 0) {
    content = <ContinueWatchingGridSkeleton count={skeletonCount} />;
  } else if (error && items.length === 0) {
    content = <LoadErrorState message={error} onRetry={retry} />;
  } else if (items.length === 0) {
    content =
      filter === 'updated' ? (
        <LibraryEmptyState
          icon={BellOff}
          title='追更的剧集暂无更新'
          action={
            <button
              type='button'
              onClick={() => changeFilter('all')}
              className={LIBRARY_PILL_BUTTON_CLASS}
            >
              查看全部
            </button>
          }
        />
      ) : filter === 'shelved' ? (
        <LibraryEmptyState
          icon={Archive}
          title='没有搁置中的内容'
          action={
            <button
              type='button'
              onClick={() => changeFilter('all')}
              className={LIBRARY_PILL_BUTTON_CLASS}
            >
              查看全部
            </button>
          }
        />
      ) : (
        <LibraryEmptyState
          icon={History}
          title='还没有在看的内容'
          action={
            <Link href='/' className={LIBRARY_PILL_BUTTON_CLASS}>
              去首页逛逛
            </Link>
          }
        />
      );
  } else {
    const activeTotal = counts[filter] ?? items.length;
    content = (
      <>
        <ContinueWatchingGrid
          items={items}
          selecting={editing}
          selectedKeys={selectedKeys}
          onToggleSelect={toggleSelected}
          onDelete={removeItem}
          pendingCount={
            loadingMore
              ? Math.min(
                  Math.max(activeTotal - items.length, 1),
                  CONTINUE_WATCHING_PAGE_SIZE,
                )
              : 0
          }
        />
        {hasMore && !loadingMore && (
          <div ref={sentinelRef} className='mt-8 flex justify-center'>
            <button
              type='button'
              onClick={() => void loadMore()}
              className={LIBRARY_TOOLBAR_BUTTON_CLASS}
            >
              加载更多
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <ContinueWatchingPageFrame toolbar={toolbar}>
      <div
        aria-busy={refreshing || undefined}
        inert={refreshing || undefined}
        className={`transition-opacity ${refreshing ? 'opacity-60' : ''}`}
      >
        {content}
      </div>

      {error && items.length > 0 && (
        <LoadErrorState message={error} onRetry={retry} />
      )}
      <ConfirmModal
        isOpen={confirmOpen}
        title={`删除 ${confirmCount ?? 0} 条播放记录？`}
        message='删除后无法从上次的进度继续播放。'
        danger
        cancelText='取消'
        confirmText='删除'
        onCancel={() => setConfirmOpen(false)}
        onConfirm={deleteSelected}
      />
    </ContinueWatchingPageFrame>
  );
}
