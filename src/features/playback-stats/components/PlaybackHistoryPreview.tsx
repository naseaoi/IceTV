'use client';

import { History } from 'lucide-react';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import LoadErrorState from '@/components/LoadErrorState';
import { HOME_POSTER_CARD_CLASS } from '@/components/poster-card-layout';
import { PosterShelfEmpty } from '@/components/PosterShelfEmpty';
import ScrollableRow from '@/components/ScrollableRow';
import { HistoryPosterCard } from '@/features/playback-stats/components/HistoryPosterCard';
import {
  usePlaybackHistory,
  usePlaybackHistoryPlaceholder,
  usePlayHistorySession,
} from '@/features/playback-stats/hooks/usePlaybackHistory';

function HistoryShelfEmpty({ placeholder = false }: { placeholder?: boolean }) {
  return (
    <PosterShelfEmpty
      icon={<History />}
      label='还没有观看记录'
      action={{ href: '/', label: '去找片' }}
      subtitle
      placeholder={placeholder}
    />
  );
}

export function PlaybackHistoryPreviewSkeleton({
  initialCount,
}: {
  initialCount?: number;
}) {
  const { count } = usePlaybackHistoryPlaceholder(initialCount);
  if (count === 0) return <HistoryShelfEmpty placeholder />;
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
  const { items, loading, pageSize, removeEntries, error, retry } =
    usePlaybackHistory();
  const { playHistoryItem, prefetchPlayPage } = usePlayHistorySession();

  if (loading) {
    return (
      <PlaybackHistoryPreviewSkeleton initialCount={initialSkeletonCount} />
    );
  }

  if (error && items.length === 0)
    return <LoadErrorState message={error} onRetry={retry} />;

  if (items.length === 0) return <HistoryShelfEmpty />;

  return (
    <ScrollableRow>
      {items.slice(0, pageSize).map((entry) => (
        <div key={entry.id} className={HOME_POSTER_CARD_CLASS}>
          <HistoryPosterCard
            entry={entry}
            onActivate={playHistoryItem}
            onPrefetch={prefetchPlayPage}
            onDelete={async (item) => {
              if ((await removeEntries([item.id])) === 0)
                throw new Error('删除未完成');
            }}
          />
        </div>
      ))}
    </ScrollableRow>
  );
}
