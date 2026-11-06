'use client';

import { Heart, ListChecks, SearchX, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  LIBRARY_PILL_BUTTON_CLASS,
  LibraryEmptySkeleton,
  LibraryEmptyState,
  LibraryPageFrame,
} from '@/components/LibraryPage';
import ConfirmModal from '@/components/modals/ConfirmModal';
import {
  type FavoriteGridSelection,
  FavoriteGrid,
} from '@/features/favorites/components/FavoriteGrid';
import { FavoriteGridSkeleton } from '@/features/favorites/components/FavoriteGridSkeleton';
import {
  EMPTY_FAVORITE_COUNTS,
  FavoriteLibraryToolbar,
} from '@/features/favorites/components/FavoriteLibraryToolbar';
import {
  type FavoriteBatchCommand,
  FavoriteSelectionBar,
} from '@/features/favorites/components/FavoriteSelectionBar';
import { useFavoriteLibrary } from '@/features/favorites/hooks/useFavoriteLibrary';
import {
  type FavoriteFilter,
  type FavoriteSort,
} from '@/features/favorites/lib/favorite-library';
import type { FavoriteBatchInput } from '@/features/favorites/lib/library-query';
import { batchFavorites } from '@/lib/db.client';
import { FAVORITE_RENDER_CHUNK as RENDER_CHUNK } from '@/lib/favorites-count';

// all 为真时按当前搜索与筛选全选，keys 记录排除项；否则 keys 为选中项
interface FavoriteSelection {
  scope: string;
  all: boolean;
  keys: ReadonlySet<string>;
}

export function FavoritesPageSkeleton({
  skeletonCount,
}: {
  skeletonCount: number;
}) {
  return (
    <LibraryPageFrame
      title='我的收藏'
      toolbar={
        skeletonCount > 0 && (
          <FavoriteLibraryToolbar
            query=''
            onQueryChange={noop}
            filter='all'
            onFilterChange={noop}
            sort='saved'
            onSortChange={noop}
            counts={EMPTY_FAVORITE_COUNTS}
            loading
            action={
              <>
                <SelectModeButton active={false} disabled onClick={noop} />
                <ClearFavoritesButton disabled onClick={noop} />
              </>
            }
          />
        )
      }
    >
      <FavoriteGridSkeleton count={skeletonCount} />
    </LibraryPageFrame>
  );
}

function noop() {}

function ClearFavoritesButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      aria-label='清空收藏'
      title='清空收藏'
      disabled={disabled}
      onClick={onClick}
      className='flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition hover:bg-red-500/10 hover:text-red-500 disabled:pointer-events-none disabled:opacity-40 lg:h-8 lg:w-8'
    >
      <Trash2 aria-hidden='true' className='h-[18px] w-[18px]' />
    </button>
  );
}

function SelectModeButton({
  active,
  disabled,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      aria-label='多选'
      title='多选'
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-full transition disabled:pointer-events-none disabled:opacity-40 lg:h-8 lg:w-8 ${
        active
          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
          : 'text-gray-400 hover:bg-gray-900/[0.06] hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200'
      }`}
    >
      <ListChecks aria-hidden='true' className='h-[18px] w-[18px]' />
    </button>
  );
}

export function FavoritesPageClient({
  favoriteSkeletonCount = 0,
}: {
  favoriteSkeletonCount?: number;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FavoriteFilter>('all');
  const [sort, setSort] = useState<FavoriteSort>('saved');
  const {
    items,
    loading,
    refreshing,
    loadingMore,
    error,
    retry,
    skeletonCount,
    clearFavorites,
    counts,
    total: resultTotal,
    libraryTotal,
    hasMore,
    loadMore,
  } = useFavoriteLibrary(favoriteSkeletonCount, { query, filter, sort });
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const narrowed = query.trim() !== '' || filter !== 'all';
  const [selecting, setSelecting] = useState(false);
  const scope = `${filter}\n${query}`;
  const [rawSelection, setSelection] = useState<FavoriteSelection>({
    scope,
    all: false,
    keys: new Set(),
  });
  // 搜索或筛选变化后旧选择不再对应当前列表，视为空选择
  const selection = useMemo<FavoriteSelection>(
    () =>
      rawSelection.scope === scope
        ? rawSelection
        : { scope, all: false, keys: new Set() },
    [rawSelection, scope],
  );
  const [batchBusy, setBatchBusy] = useState<FavoriteBatchCommand | null>(null);
  const [batchError, setBatchError] = useState('');
  const [confirmBatchRemove, setConfirmBatchRemove] = useState(false);
  const selectedCount = selection.all
    ? Math.max(0, resultTotal - selection.keys.size)
    : selection.keys.size;
  const allSelected = resultTotal > 0 && selectedCount === resultTotal;

  const clearSelection = useCallback(() => {
    setSelection({ scope, all: false, keys: new Set() });
    setBatchError('');
  }, [scope]);
  const exitSelecting = useCallback(() => {
    setSelecting(false);
    clearSelection();
  }, [clearSelection]);
  const gridSelection = useMemo<FavoriteGridSelection | undefined>(
    () =>
      selecting
        ? {
            isSelected: (key) => selection.all !== selection.keys.has(key),
            onToggle: (key) => {
              const keys = new Set(selection.keys);
              if (keys.has(key)) keys.delete(key);
              else keys.add(key);
              setSelection({ ...selection, keys });
              setBatchError('');
            },
          }
        : undefined,
    [selecting, selection],
  );

  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirmBatchRemove) exitSelecting();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selecting, confirmBatchRemove, exitSelecting]);

  const runBatch = async (command: FavoriteBatchCommand) => {
    const target: FavoriteBatchInput['target'] = selection.all
      ? { match: { q: query, filter }, exclude: [...selection.keys] }
      : { keys: [...selection.keys] };
    setBatchBusy(command);
    setBatchError('');
    try {
      await batchFavorites(
        command === 'remove'
          ? { action: 'remove', target }
          : {
              action: 'set-status',
              target,
              watchStatus: command === 'auto' ? null : command,
            },
      );
      clearSelection();
    } catch {
      setBatchError('操作失败，请重试');
    } finally {
      setBatchBusy(null);
    }
  };

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel || loading || refreshing || loadingMore || error)
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loading, refreshing, loadingMore, error]);

  const resetNarrowing = () => {
    setQuery('');
    setFilter('all');
  };

  let content: React.ReactNode;
  if (loading) {
    content =
      skeletonCount > 0 ? (
        <FavoriteGridSkeleton count={skeletonCount} />
      ) : (
        <LibraryEmptySkeleton />
      );
  } else if (error && items.length === 0 && !refreshing) {
    content = (
      <LibraryEmptyState
        icon={SearchX}
        title={error}
        action={
          <button
            type='button'
            onClick={retry}
            className={LIBRARY_PILL_BUTTON_CLASS}
          >
            重试
          </button>
        }
      />
    );
  } else if (libraryTotal === 0 && !narrowed) {
    content = (
      <LibraryEmptyState
        icon={Heart}
        title='还没有收藏'
        action={
          <Link href='/' className={LIBRARY_PILL_BUTTON_CLASS}>
            去首页逛逛
          </Link>
        }
      />
    );
  } else if (resultTotal === 0) {
    content = (
      <LibraryEmptyState
        icon={SearchX}
        title='没有匹配的收藏'
        description={
          query.trim()
            ? `找不到与「${query.trim()}」相关的作品`
            : '当前筛选下没有作品'
        }
        action={
          <button
            type='button'
            onClick={resetNarrowing}
            className={LIBRARY_PILL_BUTTON_CLASS}
          >
            清除筛选
          </button>
        }
      />
    );
  } else {
    content = (
      <>
        <FavoriteGrid
          items={items}
          virtualized={resultTotal > RENDER_CHUNK}
          selection={gridSelection}
        />
        {hasMore && (
          <div ref={sentinelRef} className='mt-8 flex justify-center'>
            <button
              type='button'
              onClick={loadMore}
              disabled={loadingMore}
              className='inline-flex h-9 items-center rounded-full px-4 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-100'
            >
              {error
                ? '加载失败，点击重试'
                : loadingMore
                  ? '加载中'
                  : `显示更多 · 还有 ${Math.max(0, resultTotal - items.length)} 部`}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <LibraryPageFrame
      title='我的收藏'
      toolbar={
        ((loading && skeletonCount > 0) || libraryTotal > 0 || narrowed) && (
          <FavoriteLibraryToolbar
            query={query}
            onQueryChange={setQuery}
            filter={filter}
            onFilterChange={setFilter}
            sort={sort}
            onSortChange={setSort}
            counts={counts}
            loading={loading}
            action={
              (loading ? skeletonCount > 0 : libraryTotal > 0) && (
                <>
                  <SelectModeButton
                    active={selecting}
                    disabled={loading}
                    onClick={
                      selecting ? exitSelecting : () => setSelecting(true)
                    }
                  />
                  {!selecting && (
                    <ClearFavoritesButton
                      disabled={loading}
                      onClick={() => setShowClearConfirm(true)}
                    />
                  )}
                </>
              )
            }
          />
        )
      }
    >
      {error && items.length > 0 && (
        <p role='alert' className='mb-4 text-sm text-red-500'>
          {error}
          <button type='button' onClick={retry} className='ml-3 underline'>
            重试
          </button>
        </p>
      )}
      <div
        aria-busy={refreshing}
        inert={refreshing}
        className={`transition-opacity duration-200 ${refreshing ? 'opacity-60' : ''} ${selecting ? 'pb-28 md:pb-20' : ''}`}
      >
        {content}
      </div>
      {selecting && (
        <FavoriteSelectionBar
          count={selectedCount}
          allSelected={allSelected}
          busy={batchBusy}
          error={batchError}
          onToggleAll={() => {
            setBatchError('');
            setSelection({ scope, all: !allSelected, keys: new Set() });
          }}
          onCommand={(command) =>
            command === 'remove'
              ? setConfirmBatchRemove(true)
              : void runBatch(command)
          }
          onClose={exitSelecting}
        />
      )}
      <ConfirmModal
        isOpen={confirmBatchRemove}
        title={`移出 ${selectedCount} 部作品？`}
        message='评价会保留。'
        danger
        cancelText='再想想'
        confirmText='移出'
        onCancel={() => setConfirmBatchRemove(false)}
        onConfirm={async () => {
          setConfirmBatchRemove(false);
          await runBatch('remove');
        }}
      />
      <ConfirmModal
        isOpen={showClearConfirm}
        title='确认清空收藏夹？'
        message='该操作会删除所有收藏内容，删除后无法恢复。评价会保留。'
        danger
        cancelText='再想想'
        confirmText='确认清空'
        onCancel={() => setShowClearConfirm(false)}
        onConfirm={async () => {
          await clearFavorites();
          setShowClearConfirm(false);
        }}
      />
    </LibraryPageFrame>
  );
}
