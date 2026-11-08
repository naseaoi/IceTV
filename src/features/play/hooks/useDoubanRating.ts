'use client';

import { useEffect, useState } from 'react';

// 返回 undefined 表示加载中，null 表示无评分或获取失败；doubanId 为 0 时不请求
export function useDoubanRating(doubanId: number): number | null | undefined {
  const [result, setResult] = useState<{
    id: number;
    rate: number | null;
  } | null>(null);

  useEffect(() => {
    if (doubanId <= 0) return;
    let cancelled = false;
    fetch(`/api/douban/rating?id=${doubanId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { rate?: unknown } | null) => {
        if (cancelled) return;
        const rate = typeof data?.rate === 'number' ? data.rate : null;
        setResult({ id: doubanId, rate });
      })
      .catch(() => {
        if (!cancelled) setResult({ id: doubanId, rate: null });
      });
    return () => {
      cancelled = true;
    };
  }, [doubanId]);

  if (doubanId <= 0) return null;
  return result?.id === doubanId ? result.rate : undefined;
}
