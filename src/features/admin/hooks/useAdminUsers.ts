'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { adminGet } from '@/features/admin/lib/api';
import {
  type AdminUserPage,
  type AdminUserQuery,
  ADMIN_USER_PAGE_SIZE,
} from '@/features/admin/lib/user-query';

export function useAdminUsers(query: AdminUserQuery) {
  const key = JSON.stringify(query);
  const [page, setPage] = useState<AdminUserPage>({
    items: [],
    total: 0,
    nextCursor: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const load = useCallback(
    async (cursor?: string) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const id = ++generation.current;
      setLoading(true);
      setError('');
      const params = new URLSearchParams({
        ...JSON.parse(key),
        limit: String(ADMIN_USER_PAGE_SIZE),
        ...(cursor ? { cursor } : {}),
      });
      try {
        const result = await adminGet<AdminUserPage>(
          `/api/admin/user?${params}`,
          '加载用户失败',
          abort.signal,
        );
        if (id !== generation.current) return;
        setPage((previous) => ({
          ...result,
          items: cursor
            ? [
                ...new Map(
                  [...previous.items, ...result.items].map((user) => [
                    user.username,
                    user,
                  ]),
                ).values(),
              ]
            : result.items,
        }));
      } catch (cause) {
        if (id === generation.current && !abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : '加载用户失败');
      } finally {
        if (id === generation.current) setLoading(false);
      }
    },
    [key],
  );
  useEffect(() => {
    setPage({ items: [], total: 0, nextCursor: null });
    setLoading(true);
    const timer = window.setTimeout(() => void load(), 300);
    return () => {
      window.clearTimeout(timer);
      generation.current += 1;
      controller.current?.abort();
    };
  }, [load]);
  return {
    ...page,
    loading,
    error,
    refresh: load,
    loadMore: () => load(page.nextCursor || undefined),
  };
}
