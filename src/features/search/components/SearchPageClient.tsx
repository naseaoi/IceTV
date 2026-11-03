'use client';

import { SearchX } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';
import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import { POSTER_GRID_CLASS } from '@/components/poster-grid-layout';
import SearchBox from '@/components/SearchBox';
import SearchResultFilter from '@/components/SearchResultFilter';
import Spinner from '@/components/Spinner';
import VideoCard from '@/components/VideoCard';
import { warmupDanmakuSearchForNavigation } from '@/features/play/lib/danmaku/navigation-warmup';
import MobileSearchFilterControls from '@/features/search/components/MobileSearchFilterControls';
import SearchHistory from '@/features/search/components/SearchHistory';
import { VirtualizedSearchGrid } from '@/features/search/components/VirtualizedSearchGrid';
import {
  FilterState,
  useSearchAggregation,
} from '@/features/search/hooks/useSearchAggregation';
import {
  clearSearchSnapshotCache,
  useSearchExecution,
} from '@/features/search/hooks/useSearchExecution';
import { useSearchHistory } from '@/features/search/hooks/useSearchHistory';
import { useSearchViewMode } from '@/features/search/hooks/useSearchViewMode';
import { normalizeSearchQueryInput } from '@/features/search/lib/searchQuery';

const DEFAULT_FILTER_STATE: FilterState = {
  source: 'all',
  title: 'all',
  year: 'all',
  yearOrder: 'none',
};

function createDefaultFilterState(): FilterState {
  return { ...DEFAULT_FILTER_STATE };
}

const LOADING_CARD_COUNT = 14;

// 吸顶栏底色与顶栏实底态一致
const STICKY_BAR_CLASS =
  'border-b border-gray-200/70 bg-gray-50/85 backdrop-blur-xl dark:border-white/[0.06] dark:bg-gray-950/80';

function SearchStatus({
  resultCount,
  searching,
  completedSources,
  totalSources,
}: {
  resultCount: number;
  searching: boolean;
  completedSources: number;
  totalSources: number;
}) {
  return (
    <span className='flex shrink-0 items-center gap-2 text-[13px] tabular-nums text-gray-500 dark:text-gray-400'>
      {searching && totalSources > 0 && (
        <span className='flex items-center gap-1.5'>
          <Spinner className='h-3.5 w-3.5 text-brand-500' />
          {completedSources}/{totalSources}
        </span>
      )}
      {(!searching || resultCount > 0) && `${resultCount} 个结果`}
    </span>
  );
}

function SearchResultsLoading() {
  return (
    <div className={POSTER_GRID_CLASS} role='status' aria-label='正在搜索'>
      {Array.from({ length: LOADING_CARD_COUNT }, (_, index) => (
        <DoubanCardSkeleton key={index} video />
      ))}
    </div>
  );
}

function SearchEmptyState({ text }: { text: string }) {
  return (
    <div className='flex flex-col items-center justify-center gap-3 py-24 text-gray-400 dark:text-gray-500'>
      <SearchX aria-hidden='true' className='h-10 w-10 stroke-[1.5]' />
      <p className='text-sm'>{text}</p>
    </div>
  );
}

function AuthenticatedSearchPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') || '';
  const activeSearchQuery = useMemo(
    () => normalizeSearchQueryInput(urlQuery),
    [urlQuery],
  );

  const { history: searchHistory, loading: searchHistoryLoading } =
    useSearchHistory();
  const [searchQuery, setSearchQuery] = useState(activeSearchQuery);
  const [searchFocused, setSearchFocused] = useState(false);

  const [filterAll, setFilterAll] = useState<FilterState>(() =>
    createDefaultFilterState(),
  );
  const [filterAgg, setFilterAgg] = useState<FilterState>(() =>
    createDefaultFilterState(),
  );

  const [viewMode, setViewMode] = useSearchViewMode(activeSearchQuery);

  const {
    isLoading,
    setIsLoading,
    showResults,
    setShowResults,
    searchResults,
    totalSources,
    completedSources,
    useFluidSearch,
  } = useSearchExecution({
    searchParams,
    viewMode,
    filterAggYearOrder: filterAgg.yearOrder,
    filterAllYearOrder: filterAll.yearOrder,
  });

  const { filterOptions, filteredAllResults, filteredAggResults, getGroupRef } =
    useSearchAggregation({
      searchResults,
      filterAll,
      filterAgg,
      searchQuery: activeSearchQuery,
    });

  useEffect(() => {
    // 宽屏下页面输入框隐藏，聚焦由顶栏输入框的 autoFocus 负责
    !urlQuery && document.getElementById('searchInput')?.focus();
  }, [urlQuery]);

  useEffect(() => {
    if (activeSearchQuery) setSearchQuery(activeSearchQuery);
  }, [activeSearchQuery]);

  useEffect(() => {
    if (!activeSearchQuery) {
      return;
    }

    void warmupDanmakuSearchForNavigation(activeSearchQuery);
    setFilterAll(createDefaultFilterState());
    setFilterAgg(createDefaultFilterState());
  }, [activeSearchQuery]);

  const aggregate = viewMode === 'agg';
  const resultCount = aggregate
    ? filteredAggResults.length
    : filteredAllResults.length;
  const categories = aggregate
    ? filterOptions.categoriesAgg
    : filterOptions.categoriesAll;
  const filterValues = aggregate ? filterAgg : filterAll;
  const setFilterValues = (values: FilterState) =>
    aggregate ? setFilterAgg(values) : setFilterAll(values);

  const resetSearch = () => {
    clearSearchSnapshotCache(searchQuery);
    setSearchQuery('');
    setShowResults(false);
    setIsLoading(false);
    router.replace('/search');
  };

  const cancelSearch = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    if (searchQuery || activeSearchQuery) resetSearch();
  };

  return (
    <PageLayout activePath='/search' mobileHeader={false}>
      {/* 顶栏放不下输入框时由页面提供吸顶搜索栏 */}
      <div
        className={`sticky top-0 z-30 md:top-16 lg:hidden ${STICKY_BAR_CLASS}`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className={`${PAGE_CONTAINER_CLASS} flex items-center py-2.5`}>
          <SearchBox
            variant='page'
            inputId='searchInput'
            value={searchQuery}
            onValueChange={setSearchQuery}
            showHistory={Boolean(activeSearchQuery)}
            onClear={resetSearch}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className='min-w-0 flex-1'
          />
          {(searchFocused || searchQuery || activeSearchQuery) && (
            <button
              type='button'
              // 保持输入框焦点，避免失焦后按钮先消失吞掉点击
              onMouseDown={(event) => event.preventDefault()}
              onClick={cancelSearch}
              className='-mr-1 shrink-0 pl-3 pr-1 text-[15px] text-gray-700 active:opacity-60 dark:text-gray-200 md:hidden'
            >
              取消
            </button>
          )}
        </div>
        {showResults && (
          <div className={`${PAGE_CONTAINER_CLASS} pb-2.5 sm:hidden`}>
            <MobileSearchFilterControls
              resultCount={isLoading && resultCount === 0 ? null : resultCount}
              categories={categories}
              values={filterValues}
              onChange={(v) => setFilterValues(v as FilterState)}
              aggregate={aggregate}
              onAggregateChange={(next) => setViewMode(next ? 'agg' : 'all')}
            />
          </div>
        )}
      </div>

      {showResults ? (
        <>
          <div
            className={`hidden sm:block lg:sticky lg:top-16 lg:z-30 ${STICKY_BAR_CLASS}`}
          >
            <div
              className={`${PAGE_CONTAINER_CLASS} flex min-h-[60px] items-center gap-4 py-3`}
            >
              <div className='min-w-0 flex-1'>
                <SearchResultFilter
                  categories={categories}
                  values={filterValues}
                  onChange={(v) => setFilterValues(v as FilterState)}
                />
              </div>
              <SearchStatus
                resultCount={resultCount}
                searching={isLoading && useFluidSearch}
                completedSources={completedSources}
                totalSources={totalSources}
              />
              <label className='flex shrink-0 cursor-pointer select-none items-center gap-2 text-[13px] text-gray-600 dark:text-gray-300'>
                聚合
                <span className='relative'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={aggregate}
                    onChange={() => setViewMode(aggregate ? 'all' : 'agg')}
                  />
                  <span className='block h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-brand-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40 dark:bg-gray-600' />
                  <span className='absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4' />
                </span>
              </label>
            </div>
          </div>

          <div className={`${PAGE_CONTAINER_CLASS} pb-8 pt-4 sm:pt-6`}>
            {searchResults.length === 0 ? (
              isLoading ? (
                <SearchResultsLoading />
              ) : (
                <SearchEmptyState text='未找到相关结果' />
              )
            ) : resultCount === 0 ? (
              <SearchEmptyState text='当前筛选无结果' />
            ) : aggregate ? (
              <VirtualizedSearchGrid
                key='search-results-agg'
                items={filteredAggResults}
                getKey={(item) => `agg-${item.mapKey}`}
                renderItem={(item) => {
                  const singleSourceItem =
                    item.group.length === 1 ? item.group[0] : null;

                  return (
                    <VideoCard
                      ref={getGroupRef(item.mapKey)}
                      id={singleSourceItem?.id}
                      source={singleSourceItem?.source}
                      source_name={singleSourceItem?.source_name}
                      from='search'
                      isAggregate={true}
                      title={item.title}
                      poster={item.poster}
                      year={item.year}
                      episodes={item.stats.episodes}
                      source_names={item.stats.source_names}
                      douban_id={item.stats.douban_id}
                      query={
                        activeSearchQuery !== item.title
                          ? activeSearchQuery
                          : ''
                      }
                      type={item.type}
                      aggregateGroup={item.group}
                    />
                  );
                }}
              />
            ) : (
              <VirtualizedSearchGrid
                key='search-results-all'
                items={filteredAllResults}
                getKey={(item) => `all-${item.source}-${item.id}`}
                renderItem={(item) => (
                  <VideoCard
                    id={item.id}
                    title={item.title}
                    poster={item.poster}
                    episodes={item.episodes.length}
                    source={item.source}
                    source_name={item.source_name}
                    douban_id={item.douban_id}
                    query={
                      activeSearchQuery !== item.title ? activeSearchQuery : ''
                    }
                    year={item.year}
                    from='search'
                    type={item.episodes.length > 1 ? 'tv' : 'movie'}
                  />
                )}
              />
            )}
          </div>
        </>
      ) : (
        <div className={`${PAGE_CONTAINER_CLASS} pb-8 pt-5 md:pt-8`}>
          <SearchHistory
            searchHistory={searchHistory}
            setSearchQuery={setSearchQuery}
            loading={searchHistoryLoading}
          />
        </div>
      )}
    </PageLayout>
  );
}

export default function SearchPageClient() {
  return (
    <AuthenticatedRoute
      activePath='/search'
      message='请先登录后再使用搜索功能。'
      mobileHeader={{ title: '搜索', showBack: false }}
    >
      <AuthenticatedSearchPageClient />
    </AuthenticatedRoute>
  );
}
