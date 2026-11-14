'use client';

import { ListVideo } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import {
  LIBRARY_PILL_BUTTON_CLASS,
  LibraryEmptySkeleton,
  LibraryEmptyState,
} from '@/components/LibraryPage';
import { libraryChipClass } from '@/components/LibraryToolbar';
import LoadErrorState from '@/components/LoadErrorState';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import Spinner from '@/components/Spinner';
import { useInfiniteScroll } from '@/features/douban/hooks/useInfiniteScroll';
import { fetchPlazaLists } from '@/features/lists/lib/lists-client';
import { type PlazaSort, PLAZA_PAGE_SIZE } from '@/features/lists/types';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { writeListCountCookie } from '@/lib/list-count-cookies';

import { ListGrid, ListGridSkeleton } from './ListCard';

const SORT_OPTIONS: { value: PlazaSort; label: string }[] = [
  { value: 'hot', label: '最热' },
  { value: 'new', label: '最新' },
];
function PlazaContentSkeleton({
  total,
  authenticated,
}: {
  total: number;
  authenticated: boolean;
}) {
  return total === 0 ? (
    <LibraryEmptySkeleton action={authenticated} />
  ) : (
    <ListGridSkeleton count={Math.min(total, PLAZA_PAGE_SIZE)} />
  );
}

function PlazaShell({
  sort,
  onSortChange,
  authenticated,
  children,
}: {
  sort: PlazaSort;
  onSortChange?: (sort: PlazaSort) => void;
  authenticated: boolean;
  children: ReactNode;
}) {
  return (
    <PageLayout activePath='/lists'>
      <div className={`${PAGE_CONTAINER_CLASS} pb-12 pt-4 sm:pt-8`}>
        <h1 className='sr-only'>片单广场</h1>
        <div className='mb-5 flex items-center justify-between gap-3'>
          <div role='group' aria-label='排序' className='flex gap-2'>
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type='button'
                aria-pressed={sort === option.value}
                onClick={() => onSortChange?.(option.value)}
                className={libraryChipClass(sort === option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {authenticated && (
            <Link href='/me/lists' className={LIBRARY_PILL_BUTTON_CLASS}>
              我的片单
            </Link>
          )}
        </div>
        {children}
      </div>
    </PageLayout>
  );
}

// 路由 loading：总数未知时不编造骨架条数，只转圈
export function ListPlazaPageSkeleton({
  knownTotal,
}: {
  knownTotal: number | null;
}) {
  const authenticated = useAuthSession().session.status === 'authenticated';
  return (
    <PlazaShell sort='hot' authenticated={authenticated}>
      {knownTotal === null ? (
        <div className='flex justify-center py-12'>
          <Spinner className='h-6 w-6' />
        </div>
      ) : (
        <PlazaContentSkeleton
          total={knownTotal}
          authenticated={authenticated}
        />
      )}
    </PlazaShell>
  );
}

export function ListPlazaPageClient({
  initialTotal,
}: {
  // 服务端渲染时的可见片单总数，null 表示未知
  initialTotal: number | null;
}) {
  const authenticated = useAuthSession().session.status === 'authenticated';
  const [sort, setSort] = useState<PlazaSort>('hot');
  useEffect(() => {
    if (initialTotal !== null)
      writeListCountCookie('plaza_count', initialTotal);
  }, [initialTotal]);
  const fetchPage = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      fetchPlazaLists(sort, cursor, signal),
    [sort],
  );
  const {
    data,
    initialLoading,
    refreshing,
    loadingMore,
    error,
    loadMore,
    refresh,
    retry,
  } = usePagedQuery({
    // 游客与登录用户可见范围不同，切换身份时丢弃旧结果
    scopeKey: authenticated ? 'member' : 'guest',
    queryKey: sort,
    fetchPage,
    getItemKey: (list) => list.id,
  });
  const lists = data?.items ?? [];
  const cursor = data?.nextCursor;
  const total = initialTotal ?? PLAZA_PAGE_SIZE;
  // 总数在浏览期间可能变化，有下一页时至少画一张
  const moreSkeletonCount = Math.min(
    Math.max(total - lists.length, 1),
    PLAZA_PAGE_SIZE,
  );
  const sentinelRef = useInfiniteScroll<HTMLDivElement>({
    enabled:
      !!cursor && !initialLoading && !refreshing && !loadingMore && !error,
    onLoadMore: loadMore,
  });

  let content: React.ReactNode;
  if (data === null) {
    content = error ? (
      <LoadErrorState message='片单加载失败' onRetry={refresh} />
    ) : (
      <PlazaContentSkeleton total={total} authenticated={authenticated} />
    );
  } else if (lists.length === 0) {
    content = (
      <LibraryEmptyState
        icon={ListVideo}
        title='还没有公开的片单'
        action={
          authenticated ? (
            <Link href='/me/lists' className={LIBRARY_PILL_BUTTON_CLASS}>
              创建片单
            </Link>
          ) : null
        }
      />
    );
  } else {
    content = <ListGrid lists={lists} />;
  }

  return (
    <PlazaShell
      sort={sort}
      onSortChange={setSort}
      authenticated={authenticated}
    >
      <div
        aria-busy={refreshing || undefined}
        inert={refreshing || undefined}
        className={`transition-opacity duration-200 ${refreshing ? 'opacity-60' : ''}`}
      >
        {content}
      </div>
      {data !== null && error && (
        <p role='alert' className='mt-4 text-sm text-red-500'>
          加载失败
          <button type='button' onClick={retry} className='ml-3 underline'>
            重试
          </button>
        </p>
      )}
      {!initialLoading && !refreshing && !error && cursor && (
        <div ref={sentinelRef} className='mt-5'>
          {loadingMore ? (
            <ListGridSkeleton count={moreSkeletonCount} />
          ) : (
            <button
              type='button'
              onClick={loadMore}
              className={LIBRARY_PILL_BUTTON_CLASS}
            >
              加载更多
            </button>
          )}
        </div>
      )}
    </PlazaShell>
  );
}
