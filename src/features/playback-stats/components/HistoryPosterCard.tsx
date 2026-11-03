'use client';

import { Check, Play } from 'lucide-react';

import CoverImage from '@/components/CoverImage';
import type { PlaybackSession } from '@/lib/types';

function formatWatchedMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round((seconds || 0) / 60));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

function getProgressPercent(session: PlaybackSession): number {
  if (!session.total_time || session.total_time <= 0) return 0;
  return Math.min(100, (session.last_position / session.total_time) * 100);
}

interface HistoryPosterCardProps {
  session: PlaybackSession;
  onActivate: (session: PlaybackSession) => void;
  onPrefetch?: () => void;
  selectable?: boolean;
  selected?: boolean;
}

export function HistoryPosterCard({
  session,
  onActivate,
  onPrefetch,
  selectable = false,
  selected = false,
}: HistoryPosterCardProps) {
  const progress = getProgressPercent(session);

  return (
    <button
      type='button'
      onClick={() => onActivate(session)}
      onMouseEnter={selectable ? undefined : onPrefetch}
      onFocus={selectable ? undefined : onPrefetch}
      aria-pressed={selectable ? selected : undefined}
      aria-label={
        selectable ? `选择 ${session.title}` : `继续播放 ${session.title}`
      }
      className='group block w-full text-left focus:outline-none'
    >
      <div
        className={`relative aspect-[2/3] overflow-hidden rounded-lg bg-gray-200 ring-offset-2 ring-offset-gray-50 transition dark:bg-gray-800 dark:ring-offset-gray-950 ${
          selected ? 'ring-2 ring-brand-500' : ''
        } group-focus-visible:ring-2 group-focus-visible:ring-brand-400`}
      >
        <CoverImage
          src={session.cover || ''}
          alt={session.title}
          sizes='(min-width: 640px) 200px, 33vw'
        />

        {!selectable && (
          <div className='absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100'>
            <span className='flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-lg'>
              <Play className='ml-0.5 h-5 w-5 fill-current' />
            </span>
          </div>
        )}

        {selectable && (
          <div
            className={`absolute inset-0 transition ${
              selected ? 'bg-black/30' : 'group-hover:bg-black/10'
            }`}
          >
            <span
              className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${
                selected
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-white/90 bg-black/20'
              }`}
            >
              {selected && <Check className='h-3.5 w-3.5' strokeWidth={3} />}
            </span>
          </div>
        )}

        {progress > 0 && (
          <div className='absolute inset-x-0 bottom-0 h-1 bg-black/40'>
            <div
              className='h-full bg-brand-400'
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      <p className='mt-2 truncate text-[13px] font-medium text-gray-800 dark:text-gray-200'>
        {session.title}
      </p>
      <p className='mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400'>
        第 {session.episode_index} 集 · 看了{' '}
        {formatWatchedMinutes(session.watch_seconds)}
      </p>
    </button>
  );
}
