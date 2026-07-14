import { ReadonlyURLSearchParams } from 'next/navigation';
import { startTransition, useEffect, useRef, useState } from 'react';

import { addSearchHistory } from '@/lib/db.client';
import { readFluidSearch } from '@/lib/local-preferences';
import { SearchResult } from '@/lib/types';

import { normalizeSearchQueryInput } from '../lib/searchQuery';
import { sortBatchForNoOrder } from '../lib/searchUtils';

interface UseSearchExecutionParams {
  searchParams: ReadonlyURLSearchParams;
  viewMode: 'agg' | 'all';
  filterAggYearOrder: 'none' | 'asc' | 'desc';
  filterAllYearOrder: 'none' | 'asc' | 'desc';
}

interface SearchSnapshotCache {
  expiresAt: number;
  results: SearchResult[];
  totalSources: number;
  completedSources: number;
  useFluidSearch: boolean;
}

const SEARCH_SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const searchSnapshotCache = new Map<string, SearchSnapshotCache>();

function getSearchSnapshotCacheKey(query: string) {
  return query.trim().toLowerCase();
}

function getSearchSnapshot(query: string): SearchSnapshotCache | null {
  const key = getSearchSnapshotCacheKey(query);
  const snapshot = searchSnapshotCache.get(key);
  if (!snapshot) {
    return null;
  }
  if (snapshot.expiresAt <= Date.now()) {
    searchSnapshotCache.delete(key);
    return null;
  }
  return snapshot;
}

export function clearSearchSnapshotCache(query?: string) {
  if (query) {
    searchSnapshotCache.delete(getSearchSnapshotCacheKey(query));
  } else {
    searchSnapshotCache.clear();
  }
}

function setSearchSnapshot(
  query: string,
  snapshot: Omit<SearchSnapshotCache, 'expiresAt'>,
) {
  const key = getSearchSnapshotCacheKey(query);
  searchSnapshotCache.set(key, {
    ...snapshot,
    expiresAt: Date.now() + SEARCH_SNAPSHOT_TTL_MS,
  });
}

export function useSearchExecution({
  searchParams,
  viewMode,
  filterAggYearOrder,
  filterAllYearOrder,
}: UseSearchExecutionParams) {
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [totalSources, setTotalSources] = useState(0);
  const [completedSources, setCompletedSources] = useState(0);
  const [useFluidSearch, setUseFluidSearch] = useState(true);

  const currentQueryRef = useRef<string>('');
  const eventSourceRef = useRef<EventSource | null>(null);
  const pendingResultsRef = useRef<SearchResult[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const hasFirstBatchRef = useRef<boolean>(false);
  const orderingRef = useRef({
    viewMode,
    filterAggYearOrder,
    filterAllYearOrder,
  });

  useEffect(() => {
    orderingRef.current = {
      viewMode,
      filterAggYearOrder,
      filterAllYearOrder,
    };
  }, [filterAggYearOrder, filterAllYearOrder, viewMode]);

  const query = normalizeSearchQueryInput(searchParams.get('q') || '');

  useEffect(() => {
    if (query === currentQueryRef.current) return;
    currentQueryRef.current = query;

    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.close();
      } catch {}
      eventSourceRef.current = null;
    }
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingResultsRef.current = [];
    hasFirstBatchRef.current = false;

    if (query) {
      const cachedSnapshot = getSearchSnapshot(query);
      if (cachedSnapshot) {
        setSearchResults(cachedSnapshot.results);
        setTotalSources(cachedSnapshot.totalSources);
        setCompletedSources(cachedSnapshot.completedSources);
        setUseFluidSearch(cachedSnapshot.useFluidSearch);
        setIsLoading(false);
        setShowResults(true);
        addSearchHistory(query);
        return;
      }

      setSearchResults([]);
      setTotalSources(0);
      setCompletedSources(0);
      setIsLoading(true);
      setShowResults(true);

      const trimmed = query;

      // 每次搜索时重新读取设置
      let currentFluidSearch = true;
      if (typeof window !== 'undefined') {
        currentFluidSearch = readFluidSearch();
      }
      setUseFluidSearch(currentFluidSearch);

      if (currentFluidSearch) {
        // 流式搜索
        const es = new EventSource(
          `/api/search/ws?q=${encodeURIComponent(trimmed)}`,
        );
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          if (!event.data) return;
          try {
            const payload = JSON.parse(event.data);
            if (currentQueryRef.current !== trimmed) return;
            switch (payload.type) {
              case 'start':
                setTotalSources(payload.totalSources || 0);
                setCompletedSources(0);
                break;
              case 'source_result': {
                setCompletedSources((prev) => prev + 1);
                if (
                  Array.isArray(payload.results) &&
                  payload.results.length > 0
                ) {
                  const {
                    viewMode: activeViewMode,
                    filterAggYearOrder: activeAggYearOrder,
                    filterAllYearOrder: activeAllYearOrder,
                  } = orderingRef.current;
                  const activeYearOrder =
                    activeViewMode === 'agg'
                      ? activeAggYearOrder
                      : activeAllYearOrder;
                  const incoming: SearchResult[] =
                    activeYearOrder === 'none'
                      ? sortBatchForNoOrder(
                          payload.results as SearchResult[],
                          currentQueryRef.current,
                        )
                      : (payload.results as SearchResult[]);
                  pendingResultsRef.current.push(...incoming);

                  if (!hasFirstBatchRef.current) {
                    hasFirstBatchRef.current = true;
                    const toAppend = pendingResultsRef.current;
                    pendingResultsRef.current = [];
                    startTransition(() => {
                      setSearchResults((prev) => prev.concat(toAppend));
                    });
                  } else if (!flushTimerRef.current) {
                    flushTimerRef.current = window.setTimeout(() => {
                      const toAppend = pendingResultsRef.current;
                      pendingResultsRef.current = [];
                      startTransition(() => {
                        setSearchResults((prev) => prev.concat(toAppend));
                      });
                      flushTimerRef.current = null;
                    }, 80);
                  }
                }
                break;
              }
              case 'source_error':
                setCompletedSources((prev) => prev + 1);
                break;
              case 'complete':
                setCompletedSources(payload.completedSources || 0);
                // 完成前写入缓冲
                if (pendingResultsRef.current.length > 0) {
                  const toAppend = pendingResultsRef.current;
                  pendingResultsRef.current = [];
                  if (flushTimerRef.current) {
                    clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                  }
                  startTransition(() => {
                    setSearchResults((prev) => prev.concat(toAppend));
                  });
                }
                setIsLoading(false);
                try {
                  es.close();
                } catch {}
                if (eventSourceRef.current === es) {
                  eventSourceRef.current = null;
                }
                break;
            }
          } catch {}
        };

        es.onerror = () => {
          setIsLoading(false);
          if (pendingResultsRef.current.length > 0) {
            const toAppend = pendingResultsRef.current;
            pendingResultsRef.current = [];
            if (flushTimerRef.current) {
              clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            startTransition(() => {
              setSearchResults((prev) => prev.concat(toAppend));
            });
          }
          try {
            es.close();
          } catch {}
          if (eventSourceRef.current === es) {
            eventSourceRef.current = null;
          }
        };
      } else {
        // 传统搜索
        fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
          .then((response) => response.json())
          .then((data) => {
            if (currentQueryRef.current !== trimmed) return;

            if (data.results && Array.isArray(data.results)) {
              const {
                viewMode: activeViewMode,
                filterAggYearOrder: activeAggYearOrder,
                filterAllYearOrder: activeAllYearOrder,
              } = orderingRef.current;
              const activeYearOrder =
                activeViewMode === 'agg'
                  ? activeAggYearOrder
                  : activeAllYearOrder;
              const results: SearchResult[] =
                activeYearOrder === 'none'
                  ? sortBatchForNoOrder(
                      data.results as SearchResult[],
                      currentQueryRef.current,
                    )
                  : (data.results as SearchResult[]);

              setSearchResults(results);
              setTotalSources(1);
              setCompletedSources(1);
            }
            setIsLoading(false);
          })
          .catch(() => {
            setIsLoading(false);
          });
      }

      addSearchHistory(query);
    } else {
      setSearchResults([]);
      setTotalSources(0);
      setCompletedSources(0);
      setIsLoading(false);
      setShowResults(false);
    }
  }, [query]);

  useEffect(() => {
    const query = currentQueryRef.current;
    if (!query || !showResults || isLoading) {
      return;
    }

    setSearchSnapshot(query, {
      results: searchResults,
      totalSources,
      completedSources,
      useFluidSearch,
    });
  }, [
    searchResults,
    totalSources,
    completedSources,
    showResults,
    useFluidSearch,
    isLoading,
  ]);

  // 连接清理
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch {}
        eventSourceRef.current = null;
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingResultsRef.current = [];
    };
  }, []);

  return {
    isLoading,
    setIsLoading,
    showResults,
    setShowResults,
    searchResults,
    totalSources,
    completedSources,
    useFluidSearch,
    setUseFluidSearch,
  };
}
