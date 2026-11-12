import { PlaybackHistoryLibrary } from '@/features/playback-stats/components/PlaybackHistoryLibrary';
import { getListSkeletonCount } from '@/lib/list-count-cookies.server';

export default async function HistoryPage() {
  const count = await getListSkeletonCount('history_count');
  return <PlaybackHistoryLibrary initialSkeletonCount={count} />;
}
