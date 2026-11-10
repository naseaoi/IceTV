'use client';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import { HOME_POSTER_CARD_CLASS } from '@/components/poster-card-layout';
import ScrollableRow from '@/components/ScrollableRow';
import SkeletonText from '@/components/SkeletonText';
import { HistoryPosterCard } from '@/features/playback-stats/components/HistoryPosterCard';
import {
  usePlaybackHistory,
  usePlaybackHistoryPlaceholder,
  usePlayHistorySession,
} from '@/features/playback-stats/hooks/usePlaybackHistory';

// 空状态与其骨架共用
export const HISTORY_PREVIEW_EMPTY_CLASS = 'py-6 text-sm';

export function PlaybackHistoryPreviewSkeleton({
  initialCount,
}: {
  initialCount?: number;
}) {
  const { count } = usePlaybackHistoryPlaceholder(initialCount);
  if (count === 0) {
    return (
      <div aria-hidden='true' className={HISTORY_PREVIEW_EMPTY_CLASS}>
        <SkeletonText barClassName='h-3.5 w-28 rounded' />
      </div>
    );
  }
  return (
    <ScrollableRow>
      {Array.from({ length: count }, (_, index) => (
        <HomePosterCardSkeleton key={index} subtitle />
      ))}
    </ScrollableRow>
  );
}

export function PlaybackHistoryPreview({
  initialSkeletonCount,
}: {
  initialSkeletonCount?: number;
}) {
  const { items, loading, pageSize, removeEntries } = usePlaybackHistory();
  const { playHistoryItem, prefetchPlayPage } = usePlayHistorySession();

  if (loading) {
    return (
      <PlaybackHistoryPreviewSkeleton initialCount={initialSkeletonCount} />
    );
  }

  if (items.length === 0) {
    return (
      <p
        className={`${HISTORY_PREVIEW_EMPTY_CLASS} text-gray-400 dark:text-gray-500`}
      >
        还没有观看记录
      </p>
    );
  }

  return (
    <ScrollableRow>
      {items.slice(0, pageSize).map((entry) => (
        <div key={entry.id} className={HOME_POSTER_CARD_CLASS}>
          <HistoryPosterCard
            entry={entry}
            onActivate={playHistoryItem}
            onPrefetch={prefetchPlayPage}
            onDelete={async (item) => {
              await removeEntries([item.id]);
            }}
          />
        </div>
      ))}
    </ScrollableRow>
  );
}
