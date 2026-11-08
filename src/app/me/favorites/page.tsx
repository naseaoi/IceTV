import { FavoritesPageClient } from '@/features/favorites/components/FavoritesPageClient';
import { getFavoriteSkeletonCount } from '@/lib/favorites.server';
import { FAVORITE_RENDER_CHUNK } from '@/lib/favorites-count';

export default async function FavoritesPage() {
  const favoriteSkeletonCount = await getFavoriteSkeletonCount(
    FAVORITE_RENDER_CHUNK,
  );

  return <FavoritesPageClient favoriteSkeletonCount={favoriteSkeletonCount} />;
}
