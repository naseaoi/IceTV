'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';
import { DoubanPageIcon } from '@/features/douban/components/DoubanPageIcon';
import { useDoubanFeed } from '@/features/douban/hooks/useDoubanFeed';
import { useInfiniteScroll } from '@/features/douban/hooks/useInfiniteScroll';
import {
  getDoubanActivePath,
  getDoubanPageDescription,
  getDoubanPageTitle,
} from '@/features/douban/lib/pageMeta';
import { useProgressiveRender } from '@/hooks/useProgressiveRender';

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
    customCategories,
    handlePrimaryChange,
    handleSecondaryChange,
    handleMultiLevelChange,
    handleWeekdayChange,
    loadNextPage,
  } = useDoubanFeed(type);

  const skeletonData = useMemo(
    () => Array.from({ length: 25 }, (_, index) => index),
    [],
  );

  const { visibleItems: visibleDoubanData, isFullyRendered } =
    useProgressiveRender(doubanData, {
      enabled: !loading && selectorsReady,
      initialCount: 24,
      step: 18,
      delayMs: 16,
    });

  const loadingRef = useInfiniteScroll<HTMLDivElement>({
    enabled: hasMore && !isLoadingMore && !loading && isFullyRendered,
    onLoadMore: loadNextPage,
  });

  return (
    <PageLayout activePath={getDoubanActivePath(type)}>
      <div className='overflow-visible px-4 py-4 sm:px-10 sm:py-8'>
        <div className='mx-auto max-w-[95%]'>
          <div className='mb-6 space-y-4 sm:mb-8 sm:space-y-6'>
            <div>
              <h1 className='mb-1 flex items-center gap-2 text-2xl font-bold text-gray-800 dark:text-gray-200 sm:mb-2 sm:text-3xl'>
                <DoubanPageIcon type={type} className='h-6 w-6 sm:h-7 sm:w-7' />
                {getDoubanPageTitle(type)}
              </h1>
              <p className='text-sm text-gray-600 dark:text-gray-400 sm:text-base'>
                {getDoubanPageDescription(type, primarySelection)}
              </p>
            </div>

            {type !== 'custom' ? (
              <div className='rounded-2xl border border-gray-200/30 bg-white/60 p-4 backdrop-blur-sm dark:border-gray-700/30 dark:bg-gray-800/40 sm:p-6'>
                <DoubanSelector
                  type={type as 'movie' | 'tv' | 'show' | 'anime'}
                  primarySelection={primarySelection}
                  secondarySelection={secondarySelection}
                  onPrimaryChange={handlePrimaryChange}
                  onSecondaryChange={handleSecondaryChange}
                  onMultiLevelChange={handleMultiLevelChange}
                  onWeekdayChange={handleWeekdayChange}
                />
              </div>
            ) : (
              <div className='rounded-2xl border border-gray-200/30 bg-white/60 p-4 backdrop-blur-sm dark:border-gray-700/30 dark:bg-gray-800/40 sm:p-6'>
                <DoubanCustomSelector
                  customCategories={customCategories}
                  primarySelection={primarySelection}
                  secondarySelection={secondarySelection}
                  onPrimaryChange={handlePrimaryChange}
                  onSecondaryChange={handleSecondaryChange}
                />
              </div>
            )}
          </div>

          <div className='mt-8 overflow-visible'>
            <div className='grid grid-cols-3 justify-start gap-x-2 gap-y-12 px-0 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20 sm:px-2'>
              {loading || !selectorsReady
                ? skeletonData.map((index) => (
                    <DoubanCardSkeleton key={index} />
                  ))
                : visibleDoubanData.map((item) => (
                    <div key={item.id} className='w-full'>
                      <VideoCard
                        from='douban'
                        title={item.title}
                        poster={item.poster}
                        douban_id={Number(item.id)}
                        rate={item.rate}
                        year={item.year}
                        type={type === 'movie' ? 'movie' : ''}
                        isBangumi={
                          type === 'anime' && primarySelection === '每日放送'
                        }
                      />
                    </div>
                  ))}
            </div>

            {hasMore && !loading && (
              <div ref={loadingRef} className='mt-12 flex justify-center py-8'>
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
    </PageLayout>
  );
}
