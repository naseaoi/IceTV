'use client';

import { useSearchParams } from 'next/navigation';

import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector from '@/components/DoubanSelector';
import AlertModal from '@/components/modals/AlertModal';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import PosterCard from '@/components/PosterCard';
import Spinner from '@/components/Spinner';
import { VirtualizedGrid } from '@/components/VirtualizedGrid';
import { DoubanFeedLoading } from '@/features/douban/components/DoubanFeedLoading';
import { DoubanFilterBar } from '@/features/douban/components/DoubanFilterBar';
import { useDoubanFeed } from '@/features/douban/hooks/useDoubanFeed';
import { useInfiniteScroll } from '@/features/douban/hooks/useInfiniteScroll';
import {
  DOUBAN_GRID_CLASS,
  DOUBAN_GRID_ITEM_CLASS,
  DOUBAN_GRID_LAYOUT,
  DOUBAN_GRID_WRAPPER_CLASS,
} from '@/features/douban/lib/grid-layout';
import {
  getDoubanActivePath,
  getDoubanPageTitle,
  normalizeDoubanType,
} from '@/features/douban/lib/pageMeta';

export function DoubanPageClient() {
  const searchParams = useSearchParams();
  const type = normalizeDoubanType(searchParams.get('type'));

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
    bangumiCalendarError,
    clearBangumiCalendarError,
  } = useDoubanFeed(type);

  const canLoadMore = hasMore && !isLoadingMore && !loading && selectorsReady;

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
    <PageLayout activePath={getDoubanActivePath(type)}>
      <h1 className='sr-only'>{getDoubanPageTitle(type)}</h1>
      <DoubanFilterBar>{selectorNode}</DoubanFilterBar>

      <div className={`${PAGE_CONTAINER_CLASS} pb-8 pt-1 md:pt-6`}>
        <div className={DOUBAN_GRID_WRAPPER_CLASS}>
          {loading || !selectorsReady ? (
            <DoubanFeedLoading />
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
            className='flex h-24 items-center justify-center'
            data-can-load-more={canLoadMore ? 'true' : 'false'}
          >
            {isLoadingMore && (
              <Spinner
                className='h-5 w-5 text-gray-400 dark:text-gray-500'
                label='加载中'
              />
            )}
          </div>
        )}

        {!hasMore && doubanData.length > 0 && (
          <div className='mt-6 flex items-center gap-4 py-10 text-xs text-gray-400 dark:text-gray-500'>
            <span className='h-px flex-1 bg-gray-200 dark:bg-white/[0.06]' />
            已加载全部
            <span className='h-px flex-1 bg-gray-200 dark:bg-white/[0.06]' />
          </div>
        )}

        {!loading && selectorsReady && doubanData.length === 0 && (
          <div className='py-24 text-center text-sm text-gray-500 dark:text-gray-400'>
            暂无相关内容
          </div>
        )}
      </div>

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
