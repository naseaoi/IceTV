'use client';

import { PlaybackPosterCard } from '@/features/playback-stats/components/PlaybackPosterCard';
import {
  formatWatchHistoryProgress,
  getWatchHistoryProgressPercent,
} from '@/features/playback-stats/lib/history';
import type { WatchHistoryEntry } from '@/lib/types';

interface HistoryPosterCardProps {
  entry: WatchHistoryEntry;
  onActivate: (entry: WatchHistoryEntry) => void;
  onPrefetch?: () => void;
  onDelete?: (entry: WatchHistoryEntry) => void | Promise<void>;
  selectable?: boolean;
  selected?: boolean;
}

export function HistoryPosterCard({
  entry,
  onActivate,
  onPrefetch,
  onDelete,
  selectable = false,
  selected = false,
}: HistoryPosterCardProps) {
  return (
    <PlaybackPosterCard
      title={entry.title}
      cover={entry.cover || ''}
      coverSizes='(min-width: 640px) 200px, 33vw'
      source={entry.source}
      videoId={entry.video_id}
      year={entry.year}
      sourceName={entry.source_name}
      progress={getWatchHistoryProgressPercent(entry)}
      subtitle={formatWatchHistoryProgress(entry)}
      ariaLabel={selectable ? `选择 ${entry.title}` : `继续播放 ${entry.title}`}
      onPlay={() => onActivate(entry)}
      onPrefetch={onPrefetch}
      onDelete={onDelete ? () => onDelete(entry) : undefined}
      selectable={selectable}
      selected={selected}
    />
  );
}
