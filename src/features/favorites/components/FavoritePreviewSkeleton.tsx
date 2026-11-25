import { Heart } from 'lucide-react';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import { PosterShelfEmpty } from '@/components/PosterShelfEmpty';
import ScrollableRow from '@/components/ScrollableRow';
import {
  clampFavoriteSkeletonCount,
  FAVORITE_PREVIEW_LIMIT,
} from '@/lib/favorites-count';

export function FavoriteShelfEmpty({
  placeholder = false,
}: {
  placeholder?: boolean;
}) {
  return (
    <PosterShelfEmpty
      icon={<Heart />}
      label='还没有收藏'
      action={{ href: '/lists', label: '逛逛片单' }}
      placeholder={placeholder}
    />
  );
}

export function FavoritePreviewSkeleton({
  count = FAVORITE_PREVIEW_LIMIT,
}: {
  count?: number;
}) {
  const skeletonCount = clampFavoriteSkeletonCount(
    count,
    FAVORITE_PREVIEW_LIMIT,
  );

  if (skeletonCount === 0) return <FavoriteShelfEmpty placeholder />;

  return (
    <ScrollableRow>
      {Array.from({ length: skeletonCount }).map((_, index) => (
        <HomePosterCardSkeleton key={index} />
      ))}
    </ScrollableRow>
  );
}
