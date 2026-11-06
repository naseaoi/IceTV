import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import ScrollableRow from '@/components/ScrollableRow';
import SkeletonText from '@/components/SkeletonText';
import {
  FAVORITE_PREVIEW_EMPTY_HEIGHT_CLASS,
  FAVORITE_PREVIEW_EMPTY_TEXT_CLASS,
} from '@/features/favorites/lib/card-layout';
import {
  clampFavoriteSkeletonCount,
  FAVORITE_PREVIEW_LIMIT,
} from '@/lib/favorites-count';

export function FavoritePreviewSkeleton({
  count = FAVORITE_PREVIEW_LIMIT,
}: {
  count?: number;
}) {
  const skeletonCount = clampFavoriteSkeletonCount(
    count,
    FAVORITE_PREVIEW_LIMIT,
  );

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
          <SkeletonText
            className={FAVORITE_PREVIEW_EMPTY_TEXT_CLASS}
            barClassName='h-3.5 w-28 rounded'
          />
        </div>
      )}
    </>
  );
}
