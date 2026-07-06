import { FavoritesPageClient } from '@/features/favorites/components/FavoritesPageClient';
import { getFavoriteSkeletonCount } from '@/lib/favorites.server';

export default async function FavoritesPage() {
  const favoriteSkeletonCount = await getFavoriteSkeletonCount();

  return <FavoritesPageClient favoriteSkeletonCount={favoriteSkeletonCount} />;
}
