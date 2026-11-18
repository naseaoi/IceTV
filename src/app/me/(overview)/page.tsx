import { MinePageClient } from '@/features/home/components/MinePageClient';
import { getCapsuleCountsForCurrentUser } from '@/features/time-capsule/counts.server';
import { getFavoriteSkeletonCount } from '@/lib/favorites.server';
import { getListSkeletonCount } from '@/lib/list-count-cookies.server';

export default async function MePage() {
  const [favoriteSkeletonCount, historySkeletonCount, capsuleCounts] =
    await Promise.all([
      getFavoriteSkeletonCount(),
      getListSkeletonCount('history_count'),
      getCapsuleCountsForCurrentUser(),
    ]);

  return (
    <MinePageClient
      favoriteSkeletonCount={favoriteSkeletonCount}
      historySkeletonCount={historySkeletonCount}
      capsuleCounts={capsuleCounts}
    />
  );
}
