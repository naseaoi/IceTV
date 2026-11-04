'use client';

import { PlaybackPosterCard } from '@/features/playback-stats/components/PlaybackPosterCard';
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
  onDelete?: (session: PlaybackSession) => void | Promise<void>;
  selectable?: boolean;
  selected?: boolean;
}

export function HistoryPosterCard({
  session,
  onActivate,
  onPrefetch,
  onDelete,
  selectable = false,
  selected = false,
}: HistoryPosterCardProps) {
  return (
    <PlaybackPosterCard
      title={session.title}
      cover={session.cover || ''}
      coverSizes='(min-width: 640px) 200px, 33vw'
      source={session.source}
      videoId={session.video_id}
      year={session.year}
      sourceName={session.source_name}
      progress={getProgressPercent(session)}
      episode={session.episode_index}
      subtitle={`第 ${session.episode_index} 集 · 看了 ${formatWatchedMinutes(
        session.watch_seconds,
      )}`}
      ariaLabel={
        selectable ? `选择 ${session.title}` : `继续播放 ${session.title}`
      }
      onPlay={() => onActivate(session)}
      onPrefetch={onPrefetch}
      onDelete={onDelete ? () => onDelete(session) : undefined}
      selectable={selectable}
      selected={selected}
    />
  );
}
