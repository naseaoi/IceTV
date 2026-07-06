import { MinePageClient } from '@/features/home/components/MinePageClient';
import { getFavoriteSkeletonCount } from '@/lib/favorites.server';

export default async function MePage() {
  const favoriteSkeletonCount = await getFavoriteSkeletonCount();

  return <MinePageClient favoriteSkeletonCount={favoriteSkeletonCount} />;
}
