'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [error, setError] = useState<Error | null>(null);
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

  const publish = useCallback((page: TPage | null) => {
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
      if (cursor !== undefined && request.current) return;
      invalidate();
      const current = generation.current;
      const controller = new AbortController();
      request.current = controller;
      const firstPage = cursor === undefined;
      setPending(firstPage);
      setLoadingMore(!firstPage);
      setError(null);
      if (firstPage) {
        const snapshot = snapshots.current.get(queryKey);
        if (snapshot) publish(snapshot);
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
          publish(page);
        } else {
          const previous = dataRef.current;
          const seen = new Set(previous?.items.map(getItemKey));
          publish({
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
          });
        }
      } catch (error) {
        if (generation.current !== current || controller.signal.aborted) return;
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
      publish(null);
    }
    setError(null);
    setPending(false);
    setLoadingMore(false);
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
    if (cursor && !request.current) void requestPage(cursor);
  }, [requestPage]);

  const updateData = useCallback(
    (updater: (previous: TPage | null) => TPage | null) => {
      if (!mounted.current) return;
      snapshots.current.clear();
      publish(updater(dataRef.current));
      // 保存期间到达的旧请求不能覆盖本地结果；重新读取服务器的最终状态。
      if (request.current) void requestPage();
    },
    [publish, requestPage],
  );

  const visibleData = scope.current === scopeKey ? data : null;
  return {
    data: visibleData,
    initialLoading: visibleData === null && pending,
    refreshing: visibleData !== null && pending,
    loadingMore,
    error,
    loadMore,
    refresh,
    updateData,
  };
}
