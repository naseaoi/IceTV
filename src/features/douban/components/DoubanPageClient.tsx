'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector from '@/components/DoubanSelector';
import MobileFilterSheet from '@/components/mobile/MobileFilterSheet';
import AlertModal from '@/components/modals/AlertModal';
import PageLayout from '@/components/PageLayout';
import PosterCard from '@/components/PosterCard';
import { VirtualizedGrid } from '@/components/VirtualizedGrid';
import { DoubanPageIcon } from '@/features/douban/components/DoubanPageIcon';
import { useDoubanFeed } from '@/features/douban/hooks/useDoubanFeed';
import { useInfiniteScroll } from '@/features/douban/hooks/useInfiniteScroll';
import { getDoubanFilterSummary } from '@/features/douban/lib/filter-summary';
import {
  DOUBAN_GRID_CLASS,
  DOUBAN_GRID_ITEM_CLASS,
  DOUBAN_GRID_LAYOUT,
  DOUBAN_GRID_WRAPPER_CLASS,
} from '@/features/douban/lib/grid-layout';
import {
  getDoubanActivePath,
  getDoubanPageDescription,
  getDoubanPageTitle,
} from '@/features/douban/lib/pageMeta';

export function DoubanPageClient() {
  const searchParams = useSearchParams();
  const type = searchParams.get('type') || 'movie';

  const {
    doubanData,
    loading,
    selectorsReady,
    hasMore,
    isLoadingMore,
    primarySelection,
    secondarySelection,
    selectedWeekday,
    customCategories,
    handlePrimaryChange,
    handleSecondaryChange,
    handleMultiLevelChange,
    handleWeekdayChange,
    loadNextPage,
    bangumiCalendarError,
    clearBangumiCalendarError,
  } = useDoubanFeed(type);

  const skeletonData = useMemo(
    () => Array.from({ length: 25 }, (_, index) => index),
    [],
  );
  const canLoadMore = hasMore && !isLoadingMore && !loading && selectorsReady;
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const filterSummary = getDoubanFilterSummary({
    type,
    primarySelection,
    secondarySelection,
    selectedWeekday,
    customCategories,
  });

  const selectorNode =
    type !== 'custom' ? (
      <DoubanSelector
        type={type as 'movie' | 'tv' | 'show' | 'anime'}
        primarySelection={primarySelection}
        secondarySelection={secondarySelection}
        onPrimaryChange={handlePrimaryChange}
        onSecondaryChange={handleSecondaryChange}
        onMultiLevelChange={handleMultiLevelChange}
        onWeekdayChange={handleWeekdayChange}
      />
    ) : (
      <DoubanCustomSelector
        customCategories={customCategories}
        primarySelection={primarySelection}
        secondarySelection={secondarySelection}
        onPrimaryChange={handlePrimaryChange}
        onSecondaryChange={handleSecondaryChange}
      />
    );

  const loadingRef = useInfiniteScroll<HTMLDivElement>({
    enabled: canLoadMore,
    onLoadMore: loadNextPage,
  });

  return (
    <PageLayout
      activePath={getDoubanActivePath(type)}
      mobileHeader={{
        title: getDoubanPageTitle(type),
        showBack: true,
        actions: (
          <button
            type='button'
            aria-label='打开筛选'
            className='flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-gray-700 hover:bg-gray-200/50 dark:text-gray-200 dark:hover:bg-gray-700/50'
            onClick={() => setFilterSheetOpen(true)}
          >
            <SlidersHorizontal className='h-4 w-4' />
            筛选
          </button>
        ),
      }}
    >
      <div className='overflow-visible px-4 py-4 sm:px-10 sm:py-8'>
        <div className='mx-auto max-w-[95%]'>
          <div className='mb-4 space-y-3 sm:mb-8 sm:space-y-6'>
            <h1 className='hidden items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-200 sm:mb-2 sm:flex sm:text-3xl'>
              <DoubanPageIcon type={type} className='h-6 w-6 sm:h-7 sm:w-7' />
              {getDoubanPageTitle(type)}
            </h1>
            <p className='hidden text-sm text-gray-600 dark:text-gray-400 sm:block sm:text-base'>
              {getDoubanPageDescription(type, primarySelection)}
            </p>

            {filterSummary && (
              <button
                type='button'
                className='block max-w-full truncate text-left text-sm text-gray-600 dark:text-gray-400 sm:hidden'
                onClick={() => setFilterSheetOpen(true)}
              >
                {filterSummary}
              </button>
            )}

            <div className='hidden rounded-2xl border border-gray-200/30 bg-white/60 p-4 backdrop-blur-sm dark:border-gray-700/30 dark:bg-gray-800/40 sm:block sm:p-6'>
              {selectorNode}
            </div>
          </div>

          <div className='mt-8 overflow-visible'>
            <div className={DOUBAN_GRID_WRAPPER_CLASS}>
              {loading || !selectorsReady ? (
                <div className={DOUBAN_GRID_CLASS}>
                  {skeletonData.map((index) => (
                    <div key={index} className={DOUBAN_GRID_ITEM_CLASS}>
                      <DoubanCardSkeleton />
                    </div>
                  ))}
                </div>
              ) : (
                <VirtualizedGrid
                  items={doubanData}
                  getKey={(item) => item.id}
                  renderItem={(item) => (
                    <PosterCard
                      title={item.title}
                      poster={item.poster}
                      doubanId={Number(item.id)}
                      rate={item.rate}
                      year={item.year}
                      type={type === 'movie' ? 'movie' : ''}
                      isBangumi={
                        type === 'anime' && primarySelection === '每日放送'
                      }
                    />
                  )}
                  layout={DOUBAN_GRID_LAYOUT}
                  fallbackClassName={DOUBAN_GRID_CLASS}
                  fallbackItemClassName={DOUBAN_GRID_ITEM_CLASS}
                />
              )}
            </div>

            {hasMore && !loading && (
              <div
                ref={loadingRef}
                className='mt-12 flex justify-center py-8'
                data-can-load-more={canLoadMore ? 'true' : 'false'}
              >
                {isLoadingMore && (
                  <div className='flex items-center gap-2'>
                    <div className='h-6 w-6 animate-spin rounded-full border-b-2 border-green-500'></div>
                    <span className='text-gray-600'>加载中...</span>
                  </div>
                )}
              </div>
            )}

            {!hasMore && doubanData.length > 0 && (
              <div className='py-8 text-center text-gray-500'>
                已加载全部内容
              </div>
            )}

            {!loading && doubanData.length === 0 && (
              <div className='py-8 text-center text-gray-500'>暂无相关内容</div>
            )}
          </div>
        </div>
      </div>

      <MobileFilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
      >
        {selectorNode}
      </MobileFilterSheet>

      <AlertModal
        isOpen={Boolean(bangumiCalendarError)}
        onClose={clearBangumiCalendarError}
        type='error'
        title='番剧数据获取失败'
        message={bangumiCalendarError || undefined}
        showConfirm
        confirmText='知道了'
      />
    </PageLayout>
  );
}
