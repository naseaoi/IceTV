import { PlaybackHistoryPageSkeleton } from '@/features/playback-stats/components/PlaybackHistoryLibrary';
import { getListSkeletonCount } from '@/lib/list-count-cookies.server';

export default async function HistoryLoading() {
  const count = await getListSkeletonCount('history_count');
  return <PlaybackHistoryPageSkeleton initialCount={count} />;
}
