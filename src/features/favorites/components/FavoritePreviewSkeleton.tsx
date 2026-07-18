import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import ScrollableRow from '@/components/ScrollableRow';
import { FAVORITE_PREVIEW_EMPTY_HEIGHT_CLASS } from '@/features/favorites/lib/card-layout';

export function FavoritePreviewSkeleton({ count = 6 }: { count?: number }) {
  const skeletonCount = Math.max(0, Math.floor(count));

  return (
    <section className='mb-2'>
      <div className='mb-4 flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <div className='h-5 w-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          <div className='h-7 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        </div>
        {skeletonCount > 0 && (
          <div className='h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        )}
      </div>
      {skeletonCount > 0 ? (
        <ScrollableRow>
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <HomePosterCardSkeleton key={index} />
          ))}
        </ScrollableRow>
      ) : (
        <div className='pb-3 sm:pb-6'>
          <div
            className={`w-full animate-pulse rounded-lg bg-gray-100 dark:bg-gray-900/60 ${FAVORITE_PREVIEW_EMPTY_HEIGHT_CLASS}`}
          />
        </div>
      )}
    </section>
  );
}
