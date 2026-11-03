import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import ScrollableRow from '@/components/ScrollableRow';
import { FAVORITE_PREVIEW_EMPTY_HEIGHT_CLASS } from '@/features/favorites/lib/card-layout';

export function FavoritePreviewSkeleton({ count = 6 }: { count?: number }) {
  const skeletonCount = Math.max(0, Math.floor(count));

  return (
    <>
      {skeletonCount > 0 ? (
        <ScrollableRow>
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <HomePosterCardSkeleton key={index} />
          ))}
        </ScrollableRow>
      ) : (
        <div
          className={`flex items-center ${FAVORITE_PREVIEW_EMPTY_HEIGHT_CLASS}`}
        >
          <div className='skeleton h-3.5 w-28 rounded' />
        </div>
      )}
    </>
  );
}
