import { Star } from 'lucide-react';

import {
  liveHealthDescription,
  LiveLineHealthBadge,
} from '@/features/live/components/LiveLineHealthBadge';
import type { LiveChannelGroup } from '@/features/live/lib/liveChannelGroups';
import type { LiveChannel } from '@/features/live/types';

export function LiveChannelActions({
  group,
  currentLine,
  onSelectLine,
  favorited,
  favoriteReady,
  onFavorite,
}: {
  group: LiveChannelGroup;
  currentLine: LiveChannel;
  onSelectLine: (line: LiveChannel) => void;
  favorited: boolean;
  favoriteReady: boolean;
  onFavorite: () => void;
}) {
  return (
    <div className='flex min-w-0 items-center gap-2'>
      <div className='flex min-w-0 items-center gap-1 overflow-x-auto py-1'>
        {group.lines.length === 1 ? (
          <span className='text-xs text-gray-500 dark:text-gray-400'>
            <LiveLineHealthBadge line={currentLine} />
          </span>
        ) : (
          group.lines.map((line, index) => (
            <button
              type='button'
              key={line.id}
              onClick={() => onSelectLine(line)}
              aria-pressed={line.id === currentLine.id}
              title={liveHealthDescription(line)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${line.id === currentLine.id ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}`}
            >
              <LiveLineHealthBadge line={line} dotOnly />
              线路 {index + 1}
            </button>
          ))
        )}
      </div>
      <button
        type='button'
        title={favorited ? '取消收藏' : '收藏频道'}
        aria-label={favorited ? '取消收藏当前频道' : '收藏当前频道'}
        aria-pressed={favorited}
        disabled={!favoriteReady}
        onClick={onFavorite}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800 ${favorited ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}
      >
        <Star className={`h-4 w-4 ${favorited ? 'fill-current' : ''}`} />
      </button>
    </div>
  );
}
