'use client';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import { HOME_POSTER_CARD_CLASS } from '@/components/poster-card-layout';
import ScrollableRow from '@/components/ScrollableRow';
import { HistoryPosterCard } from '@/features/playback-stats/components/HistoryPosterCard';
import {
  usePlaybackHistory,
  usePlaybackHistoryPlaceholder,
  usePlayHistorySession,
} from '@/features/playback-stats/hooks/usePlaybackHistory';

export function PlaybackHistoryPreviewSkeleton({ count }: { count?: number }) {
  const placeholder = usePlaybackHistoryPlaceholder();
  const resolvedCount =
    count ??
    (placeholder.snapshot
      ? Math.min(placeholder.snapshot.items.length, placeholder.count)
      : placeholder.count);
  if (resolvedCount === 0) {
    return (
      <div aria-hidden='true' className='flex h-[68px] items-center'>
        <div className='skeleton h-3.5 w-28 rounded' />
      </div>
    );
  }
  return (
    <ScrollableRow>
      {Array.from({ length: resolvedCount }, (_, index) => (
        <HomePosterCardSkeleton key={index} subtitle />
      ))}
    </ScrollableRow>
  );
}

export function PlaybackHistoryPreview() {
  const { items, loading, skeletonCount } = usePlaybackHistory();
  const { playHistoryItem, prefetchPlayPage } = usePlayHistorySession();

  if (loading) {
    return <PlaybackHistoryPreviewSkeleton count={skeletonCount} />;
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
      {items.slice(0, skeletonCount).map((session) => (
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
