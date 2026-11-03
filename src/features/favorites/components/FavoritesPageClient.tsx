'use client';

import { Heart, SearchX, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import {
  LIBRARY_PILL_BUTTON_CLASS,
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
  countFavoriteFilters,
  selectFavoriteEntries,
} from '@/features/favorites/lib/favorite-library';

const RENDER_CHUNK = 48;

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
      }
    >
      {skeletonCount > 0 && <FavoriteGridSkeleton count={skeletonCount} />}
    </LibraryPageFrame>
  );
}

function noop() {}

export function FavoritesPageClient({
  favoriteSkeletonCount = 0,
}: {
  favoriteSkeletonCount?: number;
}) {
  const { entries, loading, skeletonCount, clearFavorites } =
    useFavoriteLibrary(favoriteSkeletonCount);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FavoriteFilter>('all');
  const [sort, setSort] = useState<FavoriteSort>('saved');
  const [visibleCount, setVisibleCount] = useState(RENDER_CHUNK);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const deferredQuery = useDeferredValue(query);

  const counts = useMemo(
    () => countFavoriteFilters(entries, deferredQuery),
    [entries, deferredQuery],
  );
  const selected = useMemo(
    () =>
      selectFavoriteEntries(entries, { query: deferredQuery, filter, sort }),
    [entries, deferredQuery, filter, sort],
  );
  const visibleItems = useMemo(
    () => selected.slice(0, visibleCount).map((entry) => entry.item),
    [selected, visibleCount],
  );
  const hasMore = selected.length > visibleCount;
  const narrowed = deferredQuery.trim() !== '' || filter !== 'all';

  useEffect(() => {
    setVisibleCount(RENDER_CHUNK);
  }, [deferredQuery, filter, sort]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisibleCount((current) => current + RENDER_CHUNK);
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, visibleCount]);

  const resetNarrowing = () => {
    setQuery('');
    setFilter('all');
  };

  let content: React.ReactNode;
  if (loading) {
    content =
      skeletonCount > 0 ? <FavoriteGridSkeleton count={skeletonCount} /> : null;
  } else if (entries.length === 0) {
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
  } else if (selected.length === 0) {
    content = (
      <LibraryEmptyState
        icon={SearchX}
        title='没有匹配的收藏'
        description={
          deferredQuery.trim()
            ? `找不到与「${deferredQuery.trim()}」相关的作品`
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
        <FavoriteGrid items={visibleItems} />
        {hasMore && (
          <div ref={sentinelRef} className='mt-8 flex justify-center'>
            <button
              type='button'
              onClick={() =>
                setVisibleCount((current) => current + RENDER_CHUNK)
              }
              className='inline-flex h-9 items-center rounded-full px-4 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-100'
            >
              显示更多 · 还有 {selected.length - visibleCount} 部
            </button>
          </div>
        )}
      </>
    );
  }

  const total = loading ? null : entries.length;

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
                当前显示 <span className='tabular-nums'>{selected.length}</span>{' '}
                部
              </span>
            )}
          </>
        )
      }
      action={
        entries.length > 0 && (
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
        (loading || entries.length > 0) && (
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
