'use client';

import ContinueCard from '@/components/ContinueCard';
import ContinueWatchingCardSkeleton from '@/components/ContinueWatchingCardSkeleton';
import type { ContinueWatchingItem } from '@/features/continue-watching/hooks/useContinueWatchingItems';
import { CONTINUE_WATCHING_GRID_CLASS } from '@/features/continue-watching/lib/layout';
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
  selecting,
  selectedKeys,
  onToggleSelect,
  onDelete,
  pendingCount = 0,
}: {
  items: ContinueWatchingItem[];
  selecting: boolean;
  selectedKeys: Set<string>;
  onToggleSelect: (key: string) => void;
  onDelete: (key: string) => void;
  // 加载更多时追加在末尾的骨架数
  pendingCount?: number;
}) {
  const containerRef = useListLayoutMotion<HTMLDivElement>(
    items.map((record) => record.key),
  );

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
            data-list-motion-key={record.key}
            className='min-w-0'
          >
            <ContinueCard
              fluid
              source={parsedKey.source}
              id={parsedKey.id}
              title={record.title}
              poster={record.cover}
              year={record.year}
              sourceName={record.source_name}
              currentEpisode={episodeDisplay.currentEpisode}
              totalEpisodes={episodeDisplay.totalEpisodes}
              resumeEpisodeIndex={Math.max(0, record.index - 1)}
              resumeGroup={getPlayRecordResumeGroup(record)}
              progress={getProgress(record)}
              hasUpdate={hasPlayRecordUpdate(record)}
              trackingEnabled={isTrackingEnabled(record)}
              availableEpisodes={episodeDisplay.totalEpisodes}
              resumeTime={Math.max(0, Math.floor(record.play_time || 0))}
              query={record.search_title}
              onDelete={() => onDelete(record.key)}
              selectable={selecting}
              selected={selectedKeys.has(record.key)}
              onSelect={() => onToggleSelect(record.key)}
            />
          </div>
        );
      })}
      {Array.from({ length: pendingCount }, (_, index) => (
        <ContinueWatchingCardSkeleton key={`pending-${index}`} fluid />
      ))}
    </div>
  );
}
