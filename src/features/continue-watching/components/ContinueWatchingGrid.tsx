'use client';

import { POSTER_GRID_BASE_CLASS } from '@/components/poster-grid-layout';
import VideoCard from '@/components/VideoCard';
import {
  getPlayRecordEpisodeDisplay,
  hasPlayRecordUpdate,
} from '@/lib/play-records';
import { parseStorageKey } from '@/lib/utils';

import type { ContinueWatchingItem } from '../hooks/useContinueWatchingItems';

function getProgress(record: ContinueWatchingItem) {
  if (record.total_time <= 0) return 0;
  return (record.play_time / record.total_time) * 100;
}

export function ContinueWatchingGrid({
  items,
  onDelete,
}: {
  items: ContinueWatchingItem[];
  onDelete: (key: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className='py-5 text-center text-gray-500 dark:text-gray-400'>
        暂无继续观看内容
      </div>
    );
  }

  return (
    <div
      className={`${POSTER_GRID_BASE_CLASS} px-0 sm:grid-cols-[repeat(auto-fill,_180px)] sm:gap-x-6 sm:px-2`}
    >
      {items.map((record) => {
        const parsedKey = parseStorageKey(record.key);
        if (!parsedKey) return null;

        const episodeDisplay = getPlayRecordEpisodeDisplay(record);
        return (
          <div key={record.key} className='w-full sm:w-[180px]'>
            <VideoCard
              id={parsedKey.id}
              title={record.title}
              poster={record.cover}
              year={record.year}
              source={parsedKey.source}
              source_name={record.source_name}
              progress={getProgress(record)}
              episodes={episodeDisplay.totalEpisodes}
              currentEpisode={episodeDisplay.currentEpisode}
              hasUpdate={hasPlayRecordUpdate(record)}
              trackingEnabled={record.tracking_enabled !== false}
              availableEpisodes={episodeDisplay.totalEpisodes}
              resumeEpisodeIndex={Math.max(0, record.index - 1)}
              resumeTime={Math.max(0, Math.floor(record.play_time || 0))}
              query={record.search_title}
              from='playrecord'
              onDelete={() => onDelete(record.key)}
              type={record.total_episodes > 1 ? 'tv' : ''}
            />
          </div>
        );
      })}
    </div>
  );
}
