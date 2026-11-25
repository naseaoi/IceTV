'use client';

import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import { ListLoadingState } from '@/components/ListState';
import Spinner from '@/components/Spinner';
import { SectionTitle } from '@/features/play/components/EpisodeSelector/SectionTitle';
import { getPersistedEpisodeId } from '@/features/play/lib/danmaku/episode-storage';
import {
  deleteUserDanmaku,
  fetchMyUserDanmaku,
  USER_DANMAKU_SENT_EVENT,
} from '@/features/play/lib/danmaku/user-client';
import { useListLayoutMotion } from '@/hooks/useListLayoutMotion';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { buildUserDanmakuKey } from '@/lib/user-danmaku';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

interface MyDanmakuSectionProps {
  source: string;
  videoId: string;
  episodeIndex: number;
  scopeKey: string;
  // 绑定的弹幕集变化后递增，触发重新拉取
  refreshToken: number;
  onDeleted?: () => void;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export function MyDanmakuSection({
  source,
  videoId,
  episodeIndex,
  scopeKey,
  refreshToken,
  onDeleted,
}: MyDanmakuSectionProps) {
  const { session } = useAuthSession();
  const profileId =
    session.status === 'authenticated' ? session.profileId : null;
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState('');
  const keyRef = useRef<string | null>(null);
  const fetchPage = useCallback(
    async (cursor: string | undefined, signal: AbortSignal) => {
      const episodeId = await getPersistedEpisodeId(
        source,
        videoId,
        episodeIndex,
      );
      const key = buildUserDanmakuKey(episodeId, scopeKey);
      if (!signal.aborted) keyRef.current = key;
      return fetchMyUserDanmaku(key, cursor, signal);
    },
    [source, videoId, episodeIndex, scopeKey],
  );
  const {
    data,
    currentData,
    initialLoading,
    refreshing,
    loadingMore,
    error: queryError,
    retry,
    loadMore,
    refresh,
    updateData,
  } = usePagedQuery({
    // 换集或重新绑定时立即隔离旧集，防止管理操作作用于旧列表。
    scopeKey: JSON.stringify([
      profileId,
      source,
      videoId,
      episodeIndex,
      scopeKey,
      refreshToken,
    ]),
    queryKey: 'mine',
    enabled: profileId !== null,
    fetchPage,
    getItemKey: (item) => item.id,
  });
  const items = data?.items ?? [];
  const containerRef = useListLayoutMotion<HTMLUListElement>(
    items.map((item) => item.id),
  );
  const error = mutationError || (queryError ? '弹幕加载失败，请重试' : '');

  useEffect(() => {
    keyRef.current = null;
    setMutationError('');
  }, [source, videoId, episodeIndex, scopeKey, refreshToken, profileId]);
  useEffect(() => {
    const onSent = (event: Event) => {
      if ((event as CustomEvent<string>).detail === keyRef.current) refresh();
    };
    window.addEventListener(USER_DANMAKU_SENT_EVENT, onSent);
    return () => window.removeEventListener(USER_DANMAKU_SENT_EVENT, onSent);
  }, [refresh]);

  const remove = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    setMutationError('');
    try {
      await deleteUserDanmaku(id);
      updateData(
        (previous) =>
          previous && {
            ...previous,
            items: previous.items.filter((item) => item.id !== id),
          },
      );
      onDeleted?.();
    } catch (err) {
      if (!isAbortError(err))
        setMutationError(getErrorMessage(err, '删除失败，请重试'));
    } finally {
      setDeletingId(null);
    }
  };

  if (
    items.length === 0 &&
    !currentData?.nextCursor &&
    !initialLoading &&
    !error
  )
    return null;

  return (
    <section className='flex shrink-0 flex-col gap-2'>
      <SectionTitle as='h3' label='我发送的弹幕' count={items.length} />
      {error && (
        <p role='alert' className='text-xs text-red-500'>
          {error}
          {queryError && (
            <button type='button' onClick={retry} className='ml-2 underline'>
              重试
            </button>
          )}
        </p>
      )}
      {initialLoading && <ListLoadingState className='py-4' />}
      <ul
        aria-busy={refreshing || undefined}
        inert={refreshing || undefined}
        ref={containerRef}
        className='relative max-h-40 overflow-y-auto rounded-xl bg-gray-900/[0.03] p-1 dark:bg-white/[0.04]'
      >
        {items.map((item) => (
          <li
            key={item.id}
            data-list-motion-key={String(item.id)}
            className='flex items-center gap-3 rounded-lg py-1 pl-2.5 pr-1 hover:bg-gray-900/[0.04] dark:hover:bg-white/[0.05]'
          >
            <span className='w-10 shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500'>
              {formatTime(item.time)}
            </span>
            <span className='min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200'>
              {item.text}
            </span>
            <button
              type='button'
              aria-label={`删除弹幕：${item.text}`}
              disabled={deletingId !== null}
              onClick={() => void remove(item.id)}
              className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-900/[0.06] hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.08]'
            >
              <Trash2 aria-hidden='true' className='h-3.5 w-3.5' />
            </button>
          </li>
        ))}
      </ul>
      {currentData?.nextCursor && !refreshing && !queryError && (
        <button
          type='button'
          disabled={loadingMore}
          onClick={loadMore}
          className='self-center text-xs text-gray-500 disabled:opacity-50'
        >
          {loadingMore ? (
            <Spinner label='加载中' className='h-4 w-4' />
          ) : (
            '加载更多'
          )}
        </button>
      )}
    </section>
  );
}
