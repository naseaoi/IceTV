import { ReadonlyURLSearchParams } from 'next/navigation';
import { startTransition, useEffect, useRef, useState } from 'react';

import { normalizeSearchQueryInput } from '@/features/search/lib/searchQuery';
import {
  getSearchSnapshot,
  setSearchSnapshot,
} from '@/features/search/lib/searchSnapshotCache';
import { sortBatchForNoOrder } from '@/features/search/lib/searchUtils';
import { useClientHydrated } from '@/hooks/useClientHydrated';
import { addSearchHistory } from '@/lib/db.client';
import { readFluidSearch } from '@/lib/local-preferences';
import {
  type SearchFailedSource,
  parseSearchFailedSources,
} from '@/lib/search-failed-sources';
import { SearchResult } from '@/lib/types';
import {
  DisplayableError,
  getErrorMessage,
  isAbortError,
} from '@/lib/user-facing-error';

export { clearSearchSnapshotCache } from '@/features/search/lib/searchSnapshotCache';

interface UseSearchExecutionParams {
  searchParams: ReadonlyURLSearchParams;
  viewMode: 'agg' | 'all';
  filterAggYearOrder: 'none' | 'asc' | 'desc';
  filterAllYearOrder: 'none' | 'asc' | 'desc';
}

type SearchOrdering = Pick<
  UseSearchExecutionParams,
  'viewMode' | 'filterAggYearOrder' | 'filterAllYearOrder'
>;

function orderIncomingBatch(
  results: SearchResult[],
  ordering: SearchOrdering,
  query: string,
): SearchResult[] {
  const yearOrder =
    ordering.viewMode === 'agg'
      ? ordering.filterAggYearOrder
      : ordering.filterAllYearOrder;
  return yearOrder === 'none' ? sortBatchForNoOrder(results, query) : results;
}

function withFailedSource(
  list: SearchFailedSource[],
  key: unknown,
  name: unknown,
): SearchFailedSource[] {
  if (typeof key !== 'string' || !key || list.some((s) => s.key === key)) {
    return list;
  }
  return [...list, { key, name: typeof name === 'string' ? name : key }];
}

export function useSearchExecution({
  searchParams,
  viewMode,
  filterAggYearOrder,
  filterAllYearOrder,
}: UseSearchExecutionParams) {
  const query = normalizeSearchQueryInput(searchParams.get('q') || '');
  const clientHydrated = useClientHydrated();
  const [initialSnapshot] = useState(() =>
    clientHydrated ? getSearchSnapshot(query) : null,
  );
  const [isLoading, setIsLoading] = useState(
    Boolean(query) && !initialSnapshot,
  );
  const [showResults, setShowResults] = useState(Boolean(query));
  const [searchResults, setSearchResults] = useState<SearchResult[]>(
    initialSnapshot?.results ?? [],
  );
  const [totalSources, setTotalSources] = useState(
    initialSnapshot?.totalSources ?? 0,
  );
  const [completedSources, setCompletedSources] = useState(
    initialSnapshot?.completedSources ?? 0,
  );
  const [useFluidSearch, setUseFluidSearch] = useState(
    initialSnapshot?.useFluidSearch ?? true,
  );
  const [resultsQuery, setResultsQuery] = useState(
    initialSnapshot ? query : '',
  );
  const [failedSources, setFailedSources] = useState<SearchFailedSource[]>(
    initialSnapshot?.failedSources ?? [],
  );
  const [retryingFailed, setRetryingFailed] = useState(false);
  const failedSourcesRef = useRef(failedSources);
  const retryStreamRef = useRef<EventSource | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
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
    failedSourcesRef.current = failedSources;
  }, [failedSources]);

  useEffect(() => {
    orderingRef.current = {
      viewMode,
      filterAggYearOrder,
      filterAllYearOrder,
    };
  }, [filterAggYearOrder, filterAllYearOrder, viewMode]);

  // 连接随 effect 清理关闭；StrictMode 重跑时会重新建立，不能按 query 去重跳过
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setError(null);
    currentQueryRef.current = query;
    setResultsQuery(query);
    pendingResultsRef.current = [];
    hasFirstBatchRef.current = false;

    if (query) {
      const cachedSnapshot = retryCount === 0 ? getSearchSnapshot(query) : null;
      if (cachedSnapshot) {
        setSearchResults(cachedSnapshot.results);
        setTotalSources(cachedSnapshot.totalSources);
        setCompletedSources(cachedSnapshot.completedSources);
        setFailedSources(cachedSnapshot.failedSources);
        setUseFluidSearch(cachedSnapshot.useFluidSearch);
        setIsLoading(false);
        setShowResults(true);
        addSearchHistory(query);
        return;
      }

      setSearchResults([]);
      setTotalSources(0);
      setCompletedSources(0);
      setFailedSources([]);
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
          if (!active || !event.data) return;
          try {
            const payload = JSON.parse(event.data);
            if (!active || currentQueryRef.current !== trimmed) return;
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
                  const incoming = orderIncomingBatch(
                    payload.results as SearchResult[],
                    orderingRef.current,
                    currentQueryRef.current,
                  );
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
                setFailedSources((prev) =>
                  withFailedSource(prev, payload.source, payload.sourceName),
                );
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
          } catch {
            es.onerror?.(new Event('error'));
          }
        };

        es.onerror = () => {
          if (!active) return;
          setError('搜索未完成');
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
        fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        })
          .then(async (response) => {
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              throw new DisplayableError(
                typeof data.error === 'string' ? data.error : '搜索失败',
              );
            }
            return response.json();
          })
          .then((data) => {
            if (!active || currentQueryRef.current !== trimmed) return;

            if (data.results && Array.isArray(data.results)) {
              const total =
                typeof data.totalSources === 'number' && data.totalSources > 0
                  ? data.totalSources
                  : 1;
              setSearchResults(
                orderIncomingBatch(
                  data.results as SearchResult[],
                  orderingRef.current,
                  currentQueryRef.current,
                ),
              );
              setTotalSources(total);
              setCompletedSources(total);
              setFailedSources(parseSearchFailedSources(data.failedSources));
            }
            setIsLoading(false);
          })
          .catch((error) => {
            if (!active || isAbortError(error)) return;
            setError(getErrorMessage(error, '搜索失败'));
            setIsLoading(false);
          });
      }

      addSearchHistory(query);
    } else {
      setSearchResults([]);
      setTotalSources(0);
      setCompletedSources(0);
      setFailedSources([]);
      setIsLoading(false);
      setShowResults(false);
    }

    return () => {
      active = false;
      controller.abort();
      if (retryStreamRef.current) {
        retryStreamRef.current.close();
        retryStreamRef.current = null;
        setRetryingFailed(false);
      }
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
  }, [query, retryCount]);

  useEffect(() => {
    const query = currentQueryRef.current;
    if (
      !query ||
      query !== resultsQuery ||
      !showResults ||
      isLoading ||
      retryingFailed ||
      error
    ) {
      return;
    }

    setSearchSnapshot(query, {
      results: searchResults,
      totalSources,
      completedSources,
      failedSources,
      useFluidSearch,
    });
  }, [
    error,
    failedSources,
    retryingFailed,
    resultsQuery,
    searchResults,
    totalSources,
    completedSources,
    showResults,
    useFluidSearch,
    isLoading,
  ]);

  const retryFailedSources = () => {
    const searchQuery = currentQueryRef.current;
    const targets = failedSourcesRef.current;
    if (!searchQuery || targets.length === 0 || retryStreamRef.current) return;

    const params = new URLSearchParams({
      q: searchQuery,
      retry: targets.map((s) => s.key).join(','),
    });
    const es = new EventSource(`/api/search/ws?${params}`);
    retryStreamRef.current = es;
    setRetryingFailed(true);

    const finish = () => {
      es.close();
      if (retryStreamRef.current !== es) return;
      retryStreamRef.current = null;
      setRetryingFailed(false);
    };

    es.onmessage = (event) => {
      if (retryStreamRef.current !== es) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        finish();
        return;
      }
      if (payload.type === 'source_result') {
        setFailedSources((prev) =>
          prev.filter((s) => s.key !== payload.source),
        );
        if (Array.isArray(payload.results) && payload.results.length > 0) {
          const incoming = orderIncomingBatch(
            payload.results as SearchResult[],
            orderingRef.current,
            searchQuery,
          );
          startTransition(() => {
            setSearchResults((prev) => prev.concat(incoming));
          });
        }
      } else if (payload.type === 'complete') {
        finish();
      }
    };
    es.onerror = finish;
  };

  return {
    error,
    retry: () => setRetryCount((count) => count + 1),
    failedSources,
    retryingFailed,
    retryFailedSources,
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
