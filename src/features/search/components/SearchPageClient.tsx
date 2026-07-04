'use client';

import { ChevronUp, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import { getSearchHistory, subscribeToDataUpdates } from '@/lib/db.client';
import { readAggregateSearch } from '@/lib/local-preferences';

import PageLayout from '@/components/PageLayout';
import SearchResultFilter from '@/components/SearchResultFilter';
import SearchSuggestions from '@/components/SearchSuggestions';
import VideoCard from '@/components/VideoCard';

import {
  useSearchExecution,
  clearSearchSnapshotCache,
} from '@/features/search/hooks/useSearchExecution';
import {
  useSearchAggregation,
  FilterState,
} from '@/features/search/hooks/useSearchAggregation';
import SearchHistory from '@/features/search/components/SearchHistory';
import { VirtualizedSearchGrid } from '@/features/search/components/VirtualizedSearchGrid';

const SEARCH_VIEW_MODE_STORAGE_KEY = 'searchViewModeByQuery';
const AGGREGATED_SEARCH_GRID_LAYOUT = {
  mobileContentHeight: 32,
  desktopContentHeight: 32,
};

function getSearchViewModeByQuery(query: string): 'agg' | 'all' | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return null;
  }

  try {
    const raw = sessionStorage.getItem(SEARCH_VIEW_MODE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const map = JSON.parse(raw) as Record<string, 'agg' | 'all'>;
    const mode = map[normalizedQuery];
    return mode === 'agg' || mode === 'all' ? mode : null;
  } catch {
    return null;
  }
}

function setSearchViewModeByQuery(query: string, mode: 'agg' | 'all') {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return;
  }

  try {
    const raw = sessionStorage.getItem(SEARCH_VIEW_MODE_STORAGE_KEY);
    const map = raw
      ? (JSON.parse(raw) as Record<string, 'agg' | 'all'>)
      : ({} as Record<string, 'agg' | 'all'>);
    map[normalizedQuery] = mode;
    sessionStorage.setItem(SEARCH_VIEW_MODE_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export default function SearchPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') || '';
  const activeSearchQuery = useMemo(() => urlQuery.trim(), [urlQuery]);

  // 搜索历史 & UI 状态
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // 过滤器状态
  const [filterAll, setFilterAll] = useState<FilterState>({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none',
  });
  const [filterAgg, setFilterAgg] = useState<FilterState>({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none',
  });

  // 聚合开关
  const getDefaultAggregate = () => {
    if (typeof window === 'undefined') {
      return true;
    }

    return readAggregateSearch();
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });

  // 搜索执行
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

  // 聚合、筛选、排序
  const { filterOptions, filteredAllResults, filteredAggResults, getGroupRef } =
    useSearchAggregation({
      searchResults,
      filterAll,
      filterAgg,
      searchQuery: activeSearchQuery,
    });

  // 初始化：搜索历史、滚动监听、流式搜索设置
  useEffect(() => {
    !searchParams.get('q') && document.getElementById('searchInput')?.focus();

    getSearchHistory().then(setSearchHistory);

    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      },
    );

    const getScrollTop = () =>
      window.scrollY ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;

    let frameId: number | null = null;
    const checkScrollPosition = () => {
      frameId = null;
      setShowBackToTop(getScrollTop() > 300);
    };

    const handleScroll = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(checkScrollPosition);
    };

    checkScrollPosition();

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      unsubscribe();
      window.removeEventListener('scroll', handleScroll);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  // searchParams 变化时同步 searchQuery 和 suggestions
  useEffect(() => {
    if (urlQuery) {
      setSearchQuery(urlQuery);
      setShowSuggestions(false);
    } else {
      setShowSuggestions(false);
    }
  }, [urlQuery]);

  // 按关键词恢复聚合开关状态（用于返回搜索页时保持原视图）
  useEffect(() => {
    const trimmed = urlQuery.trim();
    if (!trimmed) {
      return;
    }

    const cachedMode = getSearchViewModeByQuery(trimmed);
    if (cachedMode && cachedMode !== viewMode) {
      setViewMode(cachedMode);
    }
  }, [urlQuery]);

  // 按关键词保存当前聚合开关状态
  useEffect(() => {
    const trimmed = urlQuery.trim();
    if (!trimmed) {
      return;
    }
    setSearchViewModeByQuery(trimmed, viewMode);
  }, [urlQuery, viewMode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setShowSuggestions(value.trim() ? true : false);
  };

  const handleInputFocus = () => {
    if (searchQuery.trim()) {
      setShowSuggestions(true);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    setSearchQuery(trimmed);
    setShowSuggestions(false);

    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setSearchQuery(suggestion);
    setShowSuggestions(false);

    router.push(`/search?q=${encodeURIComponent(suggestion)}`);
  };

  const scrollToTop = () => {
    try {
      document.body.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      document.body.scrollTop = 0;
    }
  };

  return (
    <PageLayout activePath='/search'>
      <div className='overflow-visible px-4 py-4 sm:px-10 sm:py-8'>
        <div className={`${showResults ? 'mb-8 pt-0' : 'pt-[20vh]'}`}>
          <form onSubmit={handleSearch} className='mx-auto w-full max-w-2xl'>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                placeholder='搜索电影、电视剧...'
                autoComplete='off'
                className='h-12 w-full rounded-lg border border-gray-200/50 bg-gray-50/80 py-3 pl-10 pr-12 text-sm text-gray-700 placeholder-gray-400 shadow-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700'
              />

              {searchQuery && (
                <button
                  type='button'
                  onClick={() => {
                    clearSearchSnapshotCache(searchQuery);
                    setSearchQuery('');
                    setShowSuggestions(false);
                    setShowResults(false);
                    setIsLoading(false);
                    router.replace('/search');
                    document.getElementById('searchInput')?.focus();
                  }}
                  className='absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                  aria-label='清除搜索内容'
                >
                  <X className='h-5 w-5' />
                </button>
              )}

              <SearchSuggestions
                query={searchQuery}
                isVisible={showSuggestions}
                onSelect={handleSuggestionSelect}
                onClose={() => setShowSuggestions(false)}
                onEnterKey={() => {
                  const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
                  if (!trimmed) return;

                  setSearchQuery(trimmed);
                  setShowSuggestions(false);

                  router.push(`/search?q=${encodeURIComponent(trimmed)}`);
                }}
              />
            </div>
          </form>

          {!showResults && (
            <div className='mx-auto mt-8 w-full max-w-2xl'>
              <div className='mx-auto h-[120px] w-full'>
                <SearchHistory
                  searchHistory={searchHistory}
                  setSearchQuery={setSearchQuery}
                />
              </div>
            </div>
          )}
        </div>

        {showResults && (
          <div className='mx-auto mt-12 max-w-[95%] overflow-visible'>
            <section className='mb-12'>
              <div className='mb-4'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  搜索结果
                  {totalSources > 0 && useFluidSearch && (
                    <span className='ml-2 text-sm font-normal text-gray-500 dark:text-gray-400'>
                      {completedSources}/{totalSources}
                    </span>
                  )}
                  {isLoading && useFluidSearch && (
                    <span className='ml-2 inline-block align-middle'>
                      <span className='inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-green-500'></span>
                    </span>
                  )}
                </h2>
              </div>
              <div className='mb-8 flex items-center justify-between gap-3'>
                <div className='min-w-0 flex-1'>
                  {viewMode === 'agg' ? (
                    <SearchResultFilter
                      categories={filterOptions.categoriesAgg}
                      values={filterAgg}
                      onChange={(v) => setFilterAgg(v as FilterState)}
                    />
                  ) : (
                    <SearchResultFilter
                      categories={filterOptions.categoriesAll}
                      values={filterAll}
                      onChange={(v) => setFilterAll(v as FilterState)}
                    />
                  )}
                </div>
                <label className='flex shrink-0 cursor-pointer select-none items-center gap-2'>
                  <span className='text-xs text-gray-700 dark:text-gray-300 sm:text-sm'>
                    聚合
                  </span>
                  <div className='relative'>
                    <input
                      type='checkbox'
                      className='peer sr-only'
                      checked={viewMode === 'agg'}
                      onChange={() =>
                        setViewMode(viewMode === 'agg' ? 'all' : 'agg')
                      }
                    />
                    <div className='h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                    <div className='absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4'></div>
                  </div>
                </label>
              </div>
              {searchResults.length === 0 ? (
                isLoading ? (
                  <div className='flex h-40 items-center justify-center'>
                    <div className='h-8 w-8 animate-spin rounded-full border-b-2 border-green-500'></div>
                  </div>
                ) : (
                  <div className='py-8 text-center text-gray-500 dark:text-gray-400'>
                    未找到相关结果
                  </div>
                )
              ) : (
                <>
                  {viewMode === 'agg' ? (
                    <VirtualizedSearchGrid
                      key='search-results-agg'
                      items={filteredAggResults}
                      getKey={(item) => `agg-${item.mapKey}`}
                      layout={AGGREGATED_SEARCH_GRID_LAYOUT}
                      renderItem={(item) => (
                        <VideoCard
                          ref={getGroupRef(item.mapKey)}
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
                      )}
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
                            activeSearchQuery !== item.title
                              ? activeSearchQuery
                              : ''
                          }
                          year={item.year}
                          from='search'
                          type={item.episodes.length > 1 ? 'tv' : 'movie'}
                        />
                      )}
                    />
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </div>

      <button
        onClick={scrollToTop}
        className={`group fixed bottom-20 right-6 z-[500] flex h-12 w-12 items-center justify-center rounded-full bg-green-500/90 text-white shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out hover:bg-green-500 md:bottom-6 ${
          showBackToTop
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-4 opacity-0'
        }`}
        aria-label='返回顶部'
      >
        <ChevronUp className='h-6 w-6 transition-transform group-hover:scale-110' />
      </button>
    </PageLayout>
  );
}
