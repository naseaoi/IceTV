import { FavoritesPageSkeleton } from '@/features/favorites/components/FavoritesPageClient';
import { getFavoriteSkeletonCount } from '@/lib/favorites.server';

export default async function FavoritesLoading() {
  const favoriteSkeletonCount = await getFavoriteSkeletonCount();

  return <FavoritesPageSkeleton skeletonCount={favoriteSkeletonCount} />;
}
