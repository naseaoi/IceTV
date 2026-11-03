'use client';

import HomePosterCardSkeleton, {
  HOME_POSTER_CARD_CLASS,
} from '@/components/HomePosterCardSkeleton';
import ScrollableRow from '@/components/ScrollableRow';
import { HistoryPosterCard } from '@/features/playback-stats/components/HistoryPosterCard';
import {
  usePlaybackHistory,
  usePlayHistorySession,
} from '@/features/playback-stats/hooks/usePlaybackHistory';

export function PlaybackHistoryPreview() {
  const { items, loading, skeletonCount } = usePlaybackHistory();
  const { playHistoryItem, prefetchPlayPage } = usePlayHistorySession();

  if (loading) {
    return (
      <ScrollableRow>
        {Array.from({ length: skeletonCount }).map((_, index) => (
          <HomePosterCardSkeleton key={index} />
        ))}
      </ScrollableRow>
    );
  }

  if (items.length === 0) {
    return (
      <p className='py-6 text-sm text-gray-400 dark:text-gray-500'>
        还没有观看记录
      </p>
    );
  }

  return (
    <ScrollableRow>
      {items.map((session) => (
        <div key={session.id} className={HOME_POSTER_CARD_CLASS}>
          <HistoryPosterCard
            session={session}
            onActivate={playHistoryItem}
            onPrefetch={prefetchPlayPage}
          />
        </div>
      ))}
    </ScrollableRow>
  );
}
