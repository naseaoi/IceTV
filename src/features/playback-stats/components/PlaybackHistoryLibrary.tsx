'use client';

import { History, Search, SearchX, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import {
  LIBRARY_PILL_BUTTON_CLASS,
  LibraryEmptySkeleton,
  LibraryEmptyState,
} from '@/components/LibraryPage';
import ConfirmModal from '@/components/modals/ConfirmModal';
import { POSTER_GRID_CLASS } from '@/components/poster-grid-layout';
import SkeletonText from '@/components/SkeletonText';
import { HistoryPosterCard } from '@/features/playback-stats/components/HistoryPosterCard';
import {
  usePlaybackHistory,
  usePlaybackHistoryPlaceholder,
  usePlayHistorySession,
} from '@/features/playback-stats/hooks/usePlaybackHistory';
import { groupPlaybackSessionsByDay } from '@/features/playback-stats/lib/history';
import type { PlaybackSession } from '@/lib/types';

const GROUP_TITLE_TEXT_CLASS = 'mb-3 text-sm font-medium';

const TOOLBAR_BUTTON_CLASS =
  'inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm text-gray-600 transition hover:bg-gray-900/[0.05] hover:text-gray-900 disabled:pointer-events-none disabled:opacity-40 dark:text-gray-300 dark:hover:bg-white/[0.06] dark:hover:text-white';

export function PlaybackHistoryGridSkeleton({ count }: { count?: number }) {
  const placeholder = usePlaybackHistoryPlaceholder();
  const groups = placeholder.snapshot
    ? groupPlaybackSessionsByDay(placeholder.snapshot.items).map(
        (group) => group.sessions.length,
      )
    : [count ?? placeholder.count];
  if (groups.length === 0 || groups.every((size) => size === 0))
    return <LibraryEmptySkeleton />;
  return (
    <div aria-hidden='true' className='space-y-8'>
      {groups.map((size, groupIndex) => (
        <div key={groupIndex}>
          <SkeletonText
            className={GROUP_TITLE_TEXT_CLASS}
            barClassName='h-3.5 w-16 rounded'
          />
          <div className={POSTER_GRID_CLASS}>
            {Array.from({ length: size }, (_, index) => (
              <HomePosterCardSkeleton key={index} className='w-full' subtitle />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlaybackHistoryPageSkeleton() {
  const { snapshot } = usePlaybackHistoryPlaceholder();
  return (
    <>
      <div className='mb-4 flex items-center gap-2 py-3'>
        <div className='skeleton h-9 w-full rounded-full sm:w-72' />
        {(!snapshot || snapshot.items.length > 0) && (
          <div className='skeleton ml-auto h-9 w-[60px] shrink-0 rounded-full' />
        )}
      </div>
      <PlaybackHistoryGridSkeleton />
    </>
  );
}

export function PlaybackHistoryLibrary() {
  const {
    items,
    loading,
    skeletonCount,
    loadingMore,
    refreshing,
    searchText,
    setSearchText,
    searchKeyword,
    hasMore,
    loadMore,
    removeSessions,
  } = usePlaybackHistory();
  const { playHistoryItem, prefetchPlayPage } = usePlayHistorySession();
  const [editing, setEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const groups = useMemo(() => groupPlaybackSessionsByDay(items), [items]);
  const allSelected = items.length > 0 && selectedIds.size === items.length;

  const exitEditing = () => {
    setEditing(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (session: PlaybackSession) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(session.id)) next.delete(session.id);
      else next.add(session.id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(
      allSelected ? new Set() : new Set(items.map((item) => item.id)),
    );
  };

  const deleteSelected = async () => {
    await removeSessions(Array.from(selectedIds));
    setConfirmOpen(false);
    exitEditing();
  };

  let content: React.ReactNode;
  if (loading) {
    content = <PlaybackHistoryGridSkeleton count={skeletonCount} />;
  } else if (items.length === 0) {
    content = searchKeyword ? (
      <LibraryEmptyState
        icon={SearchX}
        title='没有匹配的记录'
        action={
          <button
            type='button'
            onClick={() => setSearchText('')}
            className={LIBRARY_PILL_BUTTON_CLASS}
          >
            清除搜索
          </button>
        }
      />
    ) : (
      <LibraryEmptyState
        icon={History}
        title='还没有观看记录'
        action={
          <Link href='/' className={LIBRARY_PILL_BUTTON_CLASS}>
            去首页逛逛
          </Link>
        }
      />
    );
  } else {
    content = (
      <div
        className={`space-y-8 transition-opacity ${
          refreshing ? 'opacity-70' : 'opacity-100'
        }`}
      >
        {groups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <h3
              className={`${GROUP_TITLE_TEXT_CLASS} text-gray-500 dark:text-gray-400`}
            >
              {group.label}
            </h3>
            <div className={POSTER_GRID_CLASS}>
              {group.sessions.map((session) => (
                <HistoryPosterCard
                  key={session.id}
                  session={session}
                  selectable={editing}
                  selected={selectedIds.has(session.id)}
                  onActivate={editing ? toggleSelected : playHistoryItem}
                  onPrefetch={prefetchPlayPage}
                  onDelete={async (item) => {
                    await removeSessions([item.id]);
                  }}
                />
              ))}
            </div>
          </section>
        ))}

        {hasMore && (
          <div className='flex justify-center'>
            <button
              type='button'
              disabled={loadingMore}
              onClick={() => void loadMore()}
              className={TOOLBAR_BUTTON_CLASS}
            >
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className='z-20 -mx-4 mb-4 flex items-center gap-2 bg-gray-50/85 px-4 py-3 backdrop-blur-xl dark:bg-gray-950/80 sm:-mx-8 sm:px-8 md:sticky md:top-16 xl:-mx-12 xl:px-12'>
        {editing ? (
          <>
            <span className='text-sm text-gray-500 dark:text-gray-400'>
              已选{' '}
              <span className='font-medium tabular-nums text-gray-900 dark:text-gray-100'>
                {selectedIds.size}
              </span>{' '}
              项
            </span>
            <div className='ml-auto flex items-center gap-1'>
              <button
                type='button'
                onClick={toggleAll}
                className={TOOLBAR_BUTTON_CLASS}
              >
                {allSelected ? '取消全选' : '全选'}
              </button>
              <button
                type='button'
                disabled={selectedIds.size === 0}
                onClick={() => setConfirmOpen(true)}
                className='inline-flex h-9 items-center rounded-full bg-red-500 px-4 text-sm font-medium text-white transition hover:bg-red-600 disabled:pointer-events-none disabled:opacity-40'
              >
                删除
              </button>
              <button
                type='button'
                onClick={exitEditing}
                className={TOOLBAR_BUTTON_CLASS}
              >
                完成
              </button>
            </div>
          </>
        ) : (
          <>
            <label className='relative flex w-full items-center sm:w-72'>
              <Search className='pointer-events-none absolute left-3 h-4 w-4 text-gray-400 dark:text-gray-500' />
              <input
                id='playback-history-search'
                name='playbackHistorySearch'
                type='text'
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder='搜索观看记录'
                aria-label='搜索观看记录'
                className='h-9 w-full rounded-full border-0 bg-gray-900/[0.05] py-0 pl-9 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:bg-gray-900/[0.08] focus:ring-0 dark:bg-white/[0.06] dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-white/[0.1]'
              />
              {searchText && (
                <button
                  type='button'
                  aria-label='清空搜索'
                  onClick={() => setSearchText('')}
                  className='absolute right-2 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition hover:text-gray-700 dark:hover:text-gray-200'
                >
                  <X className='h-4 w-4' />
                </button>
              )}
            </label>
            {loading ? (
              <div
                aria-hidden='true'
                className='skeleton ml-auto h-9 w-[60px] shrink-0 rounded-full'
              />
            ) : (
              items.length > 0 && (
                <button
                  type='button'
                  onClick={() => setEditing(true)}
                  className={`${TOOLBAR_BUTTON_CLASS} ml-auto`}
                >
                  编辑
                </button>
              )
            )}
          </>
        )}
      </div>

      {content}

      <ConfirmModal
        isOpen={confirmOpen}
        title={`删除 ${selectedIds.size} 条观看记录？`}
        danger
        cancelText='取消'
        confirmText='删除'
        onCancel={() => setConfirmOpen(false)}
        onConfirm={deleteSelected}
      />
    </>
  );
}
