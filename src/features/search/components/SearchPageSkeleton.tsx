'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import { POSTER_GRID_CLASS } from '@/components/poster-grid-layout';

export const SEARCH_STICKY_BAR_CLASS =
  'border-b border-gray-200/70 bg-gray-50/85 backdrop-blur-xl dark:border-white/[0.06] dark:bg-gray-950/80';

export function SearchResultsLoading() {
  return (
    <div className={POSTER_GRID_CLASS} role='status' aria-label='正在搜索'>
      {Array.from({ length: 14 }, (_, index) => (
        <DoubanCardSkeleton key={index} video />
      ))}
    </div>
  );
}

export function SearchHistorySkeleton({ count = 8 }: { count?: number }) {
  return (
    <div aria-hidden='true'>
      <div className='mb-3 flex h-[27.5px] items-center justify-between'>
        <div className='skeleton h-4 w-16 rounded' />
        <div className='skeleton h-4 w-7 rounded' />
      </div>
      <div className='flex flex-wrap gap-2'>
        {Array.from({ length: count }).map((_, index) => (
          <div key={index} className='skeleton h-9 w-20 rounded-full' />
        ))}
      </div>
    </div>
  );
}

function SearchPagePlaceholder({
  showResults = false,
}: {
  showResults?: boolean;
}) {
  return (
    <PageLayout activePath='/search' mobileHeader={false}>
      <div
        className={`sticky top-0 z-30 md:top-16 lg:hidden ${SEARCH_STICKY_BAR_CLASS}`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className={`${PAGE_CONTAINER_CLASS} flex items-center py-2.5`}>
          <div className='skeleton h-11 min-w-0 flex-1 rounded-full ring-1 ring-gray-900/[0.08] dark:ring-white/10' />
          {showResults && (
            <span className='-mr-1 shrink-0 pl-3 pr-1 text-[15px] text-gray-700 dark:text-gray-200 md:hidden'>
              取消
            </span>
          )}
        </div>
        {showResults && (
          <div className={`${PAGE_CONTAINER_CLASS} pb-2.5 sm:hidden`}>
            <div className='flex h-8 items-center justify-end gap-2'>
              <div className='skeleton h-8 w-[70px] rounded-full' />
              <div className='skeleton h-8 w-[70px] rounded-full' />
            </div>
          </div>
        )}
      </div>
      {showResults ? (
        <>
          <div
            className={`hidden sm:block lg:sticky lg:top-16 lg:z-30 ${SEARCH_STICKY_BAR_CLASS}`}
          >
            <div
              className={`${PAGE_CONTAINER_CLASS} flex min-h-[60px] items-center gap-4 py-3`}
            >
              <div className='flex min-w-0 flex-1 gap-2'>
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className='skeleton h-8 w-14 rounded-full' />
                ))}
              </div>
              <div className='skeleton h-5 w-[70px] rounded-full' />
            </div>
          </div>
          <div className={`${PAGE_CONTAINER_CLASS} pb-8 pt-4 sm:pt-6`}>
            <SearchResultsLoading />
          </div>
        </>
      ) : (
        <div className={`${PAGE_CONTAINER_CLASS} pb-8 pt-5 md:pt-8`}>
          <SearchHistorySkeleton />
        </div>
      )}
    </PageLayout>
  );
}

function QueryAwareSearchPlaceholder() {
  const searchParams = useSearchParams();
  return (
    <SearchPagePlaceholder
      showResults={Boolean(searchParams.get('q')?.trim())}
    />
  );
}

export function SearchPageSkeleton() {
  return (
    <Suspense fallback={<SearchPagePlaceholder />}>
      <QueryAwareSearchPlaceholder />
    </Suspense>
  );
}
