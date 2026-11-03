'use client';

import { useEffect, useState } from 'react';

import { getSearchHistory, subscribeToDataUpdates } from '@/lib/db.client';

// enabled 为 false 时不读取，供顶栏等按需加载的入口延迟到首次聚焦
export function useSearchHistory(enabled = true) {
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setLoading(true);
    getSearchHistory()
      .then((next) => {
        if (!cancelled) setHistory(next);
      })
      .catch((error) => {
        console.error('获取搜索历史失败:', error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const unsubscribe = subscribeToDataUpdates<string[]>(
      'searchHistoryUpdated',
      setHistory,
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled]);

  return { history, loading };
}
