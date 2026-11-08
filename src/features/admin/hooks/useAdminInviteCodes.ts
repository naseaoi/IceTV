'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { adminGet } from '@/features/admin/lib/api';
import { INVITE_CODE_PAGE_SIZE } from '@/features/admin/services/inviteCodes';
import type {
  InviteCodeFilter,
  InviteCodePage,
} from '@/lib/invite-code-storage';

const EMPTY_PAGE: InviteCodePage = {
  items: [],
  total: 0,
  activeCount: 0,
  nextCursor: null,
};

export function useAdminInviteCodes(
  filter: InviteCodeFilter,
  enabled: boolean,
) {
  const [page, setPage] = useState<InviteCodePage>(EMPTY_PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [totals, setTotals] = useState<
    Partial<Record<InviteCodeFilter, number>>
  >({});
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
        filter,
        limit: String(INVITE_CODE_PAGE_SIZE),
        ...(cursor ? { cursor } : {}),
      });
      try {
        const payload = await adminGet<Partial<InviteCodePage>>(
          `/api/admin/invite-codes?${params}`,
          '加载邀请码失败',
          abort.signal,
        );
        if (id !== generation.current) return;
        const result: InviteCodePage = {
          items: Array.isArray(payload.items) ? payload.items : [],
          total: payload.total ?? 0,
          activeCount: payload.activeCount ?? 0,
          nextCursor: payload.nextCursor ?? null,
        };
        if (!cursor)
          setTotals((previous) => ({
            ...previous,
            [filter]: result.total,
            active: result.activeCount,
          }));
        setPage((previous) =>
          cursor
            ? {
                ...result,
                items: [
                  ...new Map(
                    [...previous.items, ...result.items].map((item) => [
                      item.code,
                      item,
                    ]),
                  ).values(),
                ],
              }
            : result,
        );
      } catch (cause) {
        if (id === generation.current && !abort.signal.aborted) {
          setError(cause instanceof Error ? cause.message : '加载邀请码失败');
        }
      } finally {
        if (id === generation.current) setLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    if (!enabled) return;
    setPage(EMPTY_PAGE);
    void load();
    return () => {
      generation.current += 1;
      controller.current?.abort();
    };
  }, [enabled, load]);

  return {
    ...page,
    totals,
    loading,
    error,
    refresh: () => load(),
    loadMore: () => load(page.nextCursor || undefined),
  };
}
