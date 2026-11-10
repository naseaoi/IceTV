'use client';

import VideoCard from '@/components/VideoCard';
import type { ContinueWatchingItem } from '@/features/continue-watching/hooks/useContinueWatchingItems';
import {
  CONTINUE_WATCHING_EMPTY_CLASS,
  CONTINUE_WATCHING_GRID_CLASS,
  CONTINUE_WATCHING_GRID_ITEM_CLASS,
} from '@/features/continue-watching/lib/layout';
import { useListLayoutMotion } from '@/hooks/useListLayoutMotion';
import {
  getPlayRecordEpisodeDisplay,
  getPlayRecordResumeGroup,
  hasPlayRecordUpdate,
  isTrackingEnabled,
} from '@/lib/play-records';
import { parseStorageKey } from '@/lib/utils';

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
  const containerRef = useListLayoutMotion<HTMLDivElement>(
    items.map((record) => String(record.key)),
  );
  if (items.length === 0) {
    return (
      <div
        className={`${CONTINUE_WATCHING_EMPTY_CLASS} text-center text-gray-500 dark:text-gray-400`}
      >
        暂无继续观看内容
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative ${CONTINUE_WATCHING_GRID_CLASS}`}
    >
      {items.map((record) => {
        const parsedKey = parseStorageKey(record.key);
        if (!parsedKey) return null;

        const episodeDisplay = getPlayRecordEpisodeDisplay(record);
        return (
          <div
            key={record.key}
            data-list-motion-key={String(record.key)}
            className={CONTINUE_WATCHING_GRID_ITEM_CLASS}
          >
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
              trackingEnabled={isTrackingEnabled(record)}
              availableEpisodes={episodeDisplay.totalEpisodes}
              resumeEpisodeIndex={Math.max(0, record.index - 1)}
              resumeGroup={getPlayRecordResumeGroup(record)}
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
