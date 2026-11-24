'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useProfilePage<T>(
  load: (
    cursor: string | null,
  ) => Promise<{ items: T[]; nextCursor: string | null }>,
  // 切换筛选等同一列表的重新查询：保留旧结果直到新结果到达
  { keepItems = false }: { keepItems?: boolean } = {},
) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorPhase, setErrorPhase] = useState<'first' | 'more' | null>(null);
  const dataLoad = useRef<typeof load | null>(null);
  const failedCursor = useRef<string | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const request = useCallback(
    async (next: string | null) => {
      if (busy.current || (next !== null && dataLoad.current !== load)) return;
      busy.current = true;
      const id = generation.current;
      setLoading(true);
      setError('');
      setErrorPhase(null);
      try {
        const page = await load(next);
        if (id === generation.current) {
          dataLoad.current = load;
          setItems((previous) =>
            next ? [...previous, ...page.items] : page.items,
          );
          setCursor(page.nextCursor);
        }
      } catch (error) {
        if (id === generation.current) {
          failedCursor.current = next;
          setErrorPhase(next === null ? 'first' : 'more');
          if (dataLoad.current !== load) setItems([]);
          setError((error as Error).message);
        }
      } finally {
        if (id === generation.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [load],
  );
  useEffect(() => {
    const lifecycle = generation;
    lifecycle.current++;
    busy.current = false;
    if (!keepItems) setItems([]);
    setCursor(null);
    failedCursor.current = null;
    void request(null);
    return () => {
      lifecycle.current++;
    };
  }, [request, keepItems]);
  return {
    items,
    loading,
    error,
    errorPhase,
    cursor: dataLoad.current === load ? cursor : null,
    loadMore: async () => {
      if (cursor && dataLoad.current === load) await request(cursor);
    },
    retry: () => request(failedCursor.current),
  };
}
