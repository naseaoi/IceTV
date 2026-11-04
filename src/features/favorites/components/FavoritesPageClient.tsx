'use client';

import { Heart, SearchX, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  LIBRARY_PILL_BUTTON_CLASS,
  LibraryEmptySkeleton,
  LibraryEmptyState,
  LibraryPageFrame,
  LibrarySubtitleSkeleton,
} from '@/components/LibraryPage';
import ConfirmModal from '@/components/modals/ConfirmModal';
import { FavoriteGrid } from '@/features/favorites/components/FavoriteGrid';
import { FavoriteGridSkeleton } from '@/features/favorites/components/FavoriteGridSkeleton';
import {
  EMPTY_FAVORITE_COUNTS,
  FavoriteLibraryToolbar,
} from '@/features/favorites/components/FavoriteLibraryToolbar';
import { useFavoriteLibrary } from '@/features/favorites/hooks/useFavoriteLibrary';
import {
  type FavoriteFilter,
  type FavoriteSort,
} from '@/features/favorites/lib/favorite-library';
import { FAVORITE_RENDER_CHUNK as RENDER_CHUNK } from '@/lib/favorites-count';

export function FavoritesPageSkeleton({
  skeletonCount,
}: {
  skeletonCount: number;
}) {
  return (
    <LibraryPageFrame
      title='我的收藏'
      subtitle={<LibrarySubtitleSkeleton />}
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
          />
        )
      }
    >
      <FavoriteGridSkeleton count={skeletonCount} />
    </LibraryPageFrame>
  );
}

function noop() {}

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

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel || loading || loadingMore || error) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loading, loadingMore, error]);

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
  } else if (error && items.length === 0) {
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
        <FavoriteGrid items={items} virtualized={resultTotal > RENDER_CHUNK} />
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

  const total = loading ? null : libraryTotal;

  return (
    <LibraryPageFrame
      title='我的收藏'
      subtitle={
        total === null ? (
          <LibrarySubtitleSkeleton />
        ) : (
          <>
            <span className='font-medium tabular-nums text-gray-900 dark:text-gray-100'>
              {total}
            </span>{' '}
            部作品
            {narrowed && (
              <span aria-live='polite'>
                <span className='mx-1.5 text-gray-300 dark:text-gray-600'>
                  /
                </span>
                当前显示 <span className='tabular-nums'>{resultTotal}</span> 部
              </span>
            )}
          </>
        )
      }
      action={
        libraryTotal > 0 && (
          <button
            type='button'
            aria-label='清空收藏'
            title='清空收藏'
            onClick={() => setShowClearConfirm(true)}
            className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-red-500/10 hover:text-red-500'
          >
            <Trash2 aria-hidden='true' className='h-[18px] w-[18px]' />
          </button>
        )
      }
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
          />
        )
      }
    >
      {content}
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
