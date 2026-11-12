import { MinePageClient } from '@/features/home/components/MinePageClient';
import { getFavoriteSkeletonCount } from '@/lib/favorites.server';
import { getListSkeletonCount } from '@/lib/list-count-cookies.server';

export default async function MePage() {
  const [favoriteSkeletonCount, historySkeletonCount] = await Promise.all([
    getFavoriteSkeletonCount(),
    getListSkeletonCount('history_count'),
  ]);

  return (
    <MinePageClient
      favoriteSkeletonCount={favoriteSkeletonCount}
      historySkeletonCount={historySkeletonCount}
    />
  );
}
