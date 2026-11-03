'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useProfilePage<T>(
  load: (
    cursor: string | null,
  ) => Promise<{ items: T[]; nextCursor: string | null }>,
) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const busy = useRef(false);
  const request = useCallback(
    async (next: string | null) => {
      if (busy.current) return;
      busy.current = true;
      const id = generation.current;
      setLoading(true);
      setError('');
      try {
        const page = await load(next);
        if (id === generation.current) {
          setItems((previous) =>
            next ? [...previous, ...page.items] : page.items,
          );
          setCursor(page.nextCursor);
        }
      } catch (error) {
        if (id === generation.current) setError((error as Error).message);
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
    setItems([]);
    setCursor(null);
    void request(null);
    return () => {
      lifecycle.current++;
    };
  }, [request]);
  return { items, loading, error, cursor, loadMore: () => request(cursor) };
}
