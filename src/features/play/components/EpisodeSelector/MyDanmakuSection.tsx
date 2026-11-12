'use client';

import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { SectionTitle } from '@/features/play/components/EpisodeSelector/SectionTitle';
import { getPersistedEpisodeId } from '@/features/play/lib/danmaku/episode-storage';
import {
  deleteUserDanmaku,
  fetchUserDanmaku,
  USER_DANMAKU_SENT_EVENT,
} from '@/features/play/lib/danmaku/user-client';
import { useListLayoutMotion } from '@/hooks/useListLayoutMotion';
import { type UserDanmakuItem, buildUserDanmakuKey } from '@/lib/user-danmaku';
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
  const [items, setItems] = useState<UserDanmakuItem[]>([]);
  const containerRef = useListLayoutMotion<HTMLUListElement>(
    items.map((item) => String(item.id)),
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sentToken, setSentToken] = useState(0);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    const onSent = (event: Event) => {
      if ((event as CustomEvent<string>).detail === keyRef.current) {
        setSentToken((token) => token + 1);
      }
    };
    window.addEventListener(USER_DANMAKU_SENT_EVENT, onSent);
    return () => window.removeEventListener(USER_DANMAKU_SENT_EVENT, onSent);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError('');
    void (async () => {
      try {
        const episodeId = await getPersistedEpisodeId(
          source,
          videoId,
          episodeIndex,
        );
        const key = buildUserDanmakuKey(episodeId, scopeKey);
        if (cancelled) return;
        if (keyRef.current !== key) {
          keyRef.current = key;
          setItems([]);
        }
        const result = await fetchUserDanmaku(key);
        if (!cancelled) setItems(result.items.filter((item) => item.mine));
      } catch {
        // 列表只是辅助入口，拉取失败时不打扰播放
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, videoId, episodeIndex, scopeKey, refreshToken, sentToken]);

  const remove = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    setError('');
    try {
      await deleteUserDanmaku(id);
      setItems((previous) => previous.filter((item) => item.id !== id));
      onDeleted?.();
    } catch (err) {
      if (!isAbortError(err))
        setError(getErrorMessage(err, '删除失败，请重试'));
    } finally {
      setDeletingId(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <section className='flex shrink-0 flex-col gap-2'>
      <SectionTitle as='h3' label='我发送的弹幕' count={items.length} />
      {error && (
        <p role='alert' className='text-xs text-red-500'>
          {error}
        </p>
      )}
      <ul
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
    </section>
  );
}
