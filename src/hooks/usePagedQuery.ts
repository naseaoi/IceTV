'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { isAbortError } from '@/lib/user-facing-error';

type PagedData = { items: unknown[]; nextCursor: string | null };

interface PagedQueryOptions<TPage extends PagedData> {
  scopeKey: string | null;
  queryKey: string;
  enabled?: boolean;
  fetchPage: (
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<TPage>;
  getItemKey: (item: TPage['items'][number]) => string;
}

const SNAPSHOT_LIMIT = 20;

export function usePagedQuery<TPage extends PagedData>({
  scopeKey,
  queryKey,
  enabled = true,
  fetchPage,
  getItemKey,
}: PagedQueryOptions<TPage>) {
  const [data, setData] = useState<TPage | null>(null);
  const [pending, setPending] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [requestIdentity, setRequestIdentity] = useState<{
    scopeKey: string | null;
    queryKey: string;
  } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [errorPhase, setErrorPhase] = useState<'first' | 'more' | null>(null);
  const dataQueryKey = useRef<string | null>(null);
  const failedCursor = useRef<string | undefined>(undefined);
  const dataRef = useRef<TPage | null>(null);
  const scope = useRef(scopeKey);
  const mounted = useRef(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const snapshots = useRef(new Map<string, TPage>());
  const options = useRef({ queryKey, enabled, fetchPage, getItemKey });

  useEffect(() => {
    options.current = { queryKey, enabled, fetchPage, getItemKey };
  });

  const publish = useCallback((page: TPage | null, key: string) => {
    dataQueryKey.current = key;
    dataRef.current = page;
    setData(page);
  }, []);

  const invalidate = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
  }, []);

  const requestPage = useCallback(
    async (cursor?: string) => {
      const { queryKey, enabled, fetchPage, getItemKey } = options.current;
      if (!mounted.current || !enabled) return;
      if (
        cursor !== undefined &&
        (request.current || dataQueryKey.current !== queryKey)
      )
        return;
      invalidate();
      const current = generation.current;
      const controller = new AbortController();
      request.current = controller;
      const firstPage = cursor === undefined;
      setRequestIdentity({ scopeKey: scope.current, queryKey });
      setPending(firstPage);
      setLoadingMore(!firstPage);
      setError(null);
      setErrorPhase(null);
      if (firstPage) {
        const snapshot = snapshots.current.get(queryKey);
        if (snapshot) publish(snapshot, queryKey);
      }
      try {
        const page = await fetchPage(cursor, controller.signal);
        if (generation.current !== current || controller.signal.aborted) return;
        if (firstPage) {
          snapshots.current.delete(queryKey);
          snapshots.current.set(queryKey, page);
          if (snapshots.current.size > SNAPSHOT_LIMIT) {
            const oldest = snapshots.current.keys().next().value;
            if (oldest !== undefined) snapshots.current.delete(oldest);
          }
          publish(page, queryKey);
        } else {
          const previous = dataRef.current;
          const seen = new Set(previous?.items.map(getItemKey));
          publish(
            {
              ...page,
              items: [
                ...(previous?.items ?? []),
                ...page.items.filter((item) => {
                  const key = getItemKey(item);
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                }),
              ],
            },
            queryKey,
          );
        }
      } catch (error) {
        if (
          generation.current !== current ||
          controller.signal.aborted ||
          isAbortError(error)
        )
          return;
        failedCursor.current = cursor;
        setErrorPhase(firstPage ? 'first' : 'more');
        if (firstPage) snapshots.current.delete(queryKey);
        setError(
          error instanceof Error ? error : new Error('Page request failed'),
        );
      } finally {
        if (generation.current === current) {
          request.current = null;
          setPending(false);
          setLoadingMore(false);
        }
      }
    },
    [invalidate, publish],
  );

  useEffect(() => {
    mounted.current = true;
    if (scope.current !== scopeKey) {
      scope.current = scopeKey;
      snapshots.current.clear();
      publish(null, queryKey);
    }
    setError(null);
    setErrorPhase(null);
    failedCursor.current = undefined;
    setPending(false);
    setLoadingMore(false);
    if (!enabled) setRequestIdentity(null);
    void requestPage();
    return () => {
      mounted.current = false;
      invalidate();
    };
  }, [scopeKey, queryKey, enabled, invalidate, publish, requestPage]);

  const refresh = useCallback(() => {
    snapshots.current.clear();
    void requestPage();
  }, [requestPage]);

  const loadMore = useCallback(() => {
    const cursor = dataRef.current?.nextCursor;
    if (
      cursor &&
      !request.current &&
      dataQueryKey.current === options.current.queryKey
    )
      void requestPage(cursor);
  }, [requestPage]);

  const updateData = useCallback(
    (updater: (previous: TPage | null) => TPage | null) => {
      if (
        !mounted.current ||
        (dataRef.current && dataQueryKey.current !== options.current.queryKey)
      )
        return;
      snapshots.current.clear();
      publish(updater(dataRef.current), options.current.queryKey);
      // 保存期间到达的旧请求不能覆盖本地结果；重新读取服务器的最终状态。
      if (request.current) void requestPage();
    },
    [publish, requestPage],
  );

  const isCurrentRequest =
    requestIdentity?.scopeKey === scopeKey &&
    requestIdentity?.queryKey === queryKey;
  const currentError = enabled && isCurrentRequest ? error : null;
  // effect 发起请求前就隔离旧状态；切回条件时直接展示该条件的首页快照。
  const snapshot =
    enabled && !isCurrentRequest && scope.current === scopeKey
      ? snapshots.current.get(queryKey)
      : undefined;
  const isCurrentData =
    scope.current === scopeKey && dataQueryKey.current === queryKey;
  const currentData = snapshot ?? (isCurrentData ? data : null);
  const visibleData =
    currentData ?? (scope.current === scopeKey && !currentError ? data : null);
  const currentPending = enabled && (!isCurrentRequest || pending);
  return {
    data: visibleData,
    currentData,
    isPlaceholderData: visibleData !== null && currentData === null,
    errorPhase: currentError ? errorPhase : null,
    initialLoading: visibleData === null && currentPending,
    refreshing: visibleData !== null && currentPending,
    loadingMore: enabled && isCurrentRequest && loadingMore,
    error: currentError,
    loadMore,
    refresh,
    retry: () => void requestPage(failedCursor.current),
    updateData,
  };
}
