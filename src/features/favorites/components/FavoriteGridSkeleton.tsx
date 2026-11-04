import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import { LibraryEmptySkeleton } from '@/components/LibraryPage';
import { POSTER_GRID_CLASS } from '@/components/poster-grid-layout';
import {
  clampFavoriteSkeletonCount,
  FAVORITE_RENDER_CHUNK,
} from '@/lib/favorites-count';

export function FavoriteGridSkeleton({
  count = FAVORITE_RENDER_CHUNK,
}: {
  count?: number;
}) {
  const skeletonCount = clampFavoriteSkeletonCount(
    count,
    FAVORITE_RENDER_CHUNK,
  );
  if (!skeletonCount) return <LibraryEmptySkeleton />;
  return (
    <div className={POSTER_GRID_CLASS}>
      {Array.from({ length: skeletonCount }).map((_, index) => (
        <div key={index} className='w-full'>
          <HomePosterCardSkeleton className='w-full' />
        </div>
      ))}
    </div>
  );
}
