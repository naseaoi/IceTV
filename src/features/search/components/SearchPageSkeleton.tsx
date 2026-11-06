'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import PageLayout from '@/components/PageLayout';
import { POSTER_GRID_CLASS } from '@/components/poster-grid-layout';
import { SEARCH_BOX_PAGE_SHAPE_CLASS } from '@/components/SearchBox';
import SkeletonText, { SKELETON_TEXT_STRUT } from '@/components/SkeletonText';
import {
  SEARCH_CANCEL_BUTTON_CLASS,
  SEARCH_DESKTOP_BAR_CLASS,
  SEARCH_DESKTOP_BAR_ROW_CLASS,
  SEARCH_HISTORY_CHIP_SHAPE_CLASS,
  SEARCH_HISTORY_CONTAINER_CLASS,
  SEARCH_HISTORY_HEADER_BUTTON_SHAPE_CLASS,
  SEARCH_HISTORY_HEADER_CLASS,
  SEARCH_HISTORY_TITLE_TEXT_CLASS,
  SEARCH_MOBILE_BAR_CLASS,
  SEARCH_MOBILE_BAR_ROW_CLASS,
  SEARCH_MOBILE_FILTER_ROW_CLASS,
  SEARCH_RESULTS_CONTAINER_CLASS,
} from '@/features/search/lib/search-layout';

export function SearchResultsLoading() {
  return (
    <div className={POSTER_GRID_CLASS} role='status' aria-label='正在搜索'>
      {Array.from({ length: 14 }, (_, index) => (
        <HomePosterCardSkeleton key={index} className='w-full' subtitle />
      ))}
    </div>
  );
}

export function SearchHistorySkeleton({ count = 8 }: { count?: number }) {
  return (
    <div aria-hidden='true'>
      <div className={SEARCH_HISTORY_HEADER_CLASS}>
        <SkeletonText
          className={SEARCH_HISTORY_TITLE_TEXT_CLASS}
          barClassName='h-4 w-16 rounded'
        />
        <SkeletonText
          className={SEARCH_HISTORY_HEADER_BUTTON_SHAPE_CLASS}
          barClassName='h-4 w-7 rounded'
        />
      </div>
      <div className='flex flex-wrap gap-2'>
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className={`skeleton w-20 ${SEARCH_HISTORY_CHIP_SHAPE_CLASS}`}
          >
            {SKELETON_TEXT_STRUT}
          </div>
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
        className={SEARCH_MOBILE_BAR_CLASS}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className={SEARCH_MOBILE_BAR_ROW_CLASS}>
          <div
            className={`skeleton min-w-0 flex-1 ring-1 ring-gray-900/[0.08] dark:ring-white/10 ${SEARCH_BOX_PAGE_SHAPE_CLASS}`}
          />
          {showResults && (
            <span className={SEARCH_CANCEL_BUTTON_CLASS}>取消</span>
          )}
        </div>
        {showResults && (
          <div className={SEARCH_MOBILE_FILTER_ROW_CLASS}>
            <div className='flex h-8 items-center justify-end gap-2'>
              <div className='skeleton h-8 w-[70px] rounded-full' />
              <div className='skeleton h-8 w-[70px] rounded-full' />
            </div>
          </div>
        )}
      </div>
      {showResults ? (
        <>
          <div className={SEARCH_DESKTOP_BAR_CLASS}>
            <div className={SEARCH_DESKTOP_BAR_ROW_CLASS}>
              <div className='flex min-w-0 flex-1 gap-2'>
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className='skeleton h-8 w-14 rounded-full' />
                ))}
              </div>
              <div className='skeleton h-5 w-[70px] rounded-full' />
            </div>
          </div>
          <div className={SEARCH_RESULTS_CONTAINER_CLASS}>
            <SearchResultsLoading />
          </div>
        </>
      ) : (
        <div className={SEARCH_HISTORY_CONTAINER_CLASS}>
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
