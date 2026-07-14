import PageLayout from '@/components/PageLayout';
import { FavoritePreviewSkeleton } from '@/features/favorites/components/FavoritePreviewSkeleton';
import { PlaybackHistorySkeleton } from '@/features/playback-stats/components/PlaybackHistorySkeleton';
import { PlaybackStatsSkeleton } from '@/features/playback-stats/components/PlaybackStatsSkeleton';
import { getFavoriteSkeletonCount } from '@/lib/favorites.server';

function MineSwitchSkeleton() {
  return (
    <div className='relative flex items-end'>
      <div className='absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-gray-300/60 to-transparent dark:via-white/20' />
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className='relative px-6 py-3'>
          <div className='flex items-center gap-2'>
            <div className='h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            <div className='h-5 w-10 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function MeLoading() {
  const favoriteSkeletonCount = await getFavoriteSkeletonCount();

  return (
    <PageLayout activePath='/'>
      <div className='overflow-visible px-2 pb-2 pt-4 sm:px-10 sm:pt-8'>
        <div className='mb-4 hidden justify-center md:flex'>
          <MineSwitchSkeleton />
        </div>

        <div className='mx-auto max-w-[95%]'>
          <div className='mb-4 flex gap-3 md:hidden'>
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className='min-h-[64px] flex-1 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800'
              />
            ))}
          </div>

          <div className='-mb-3 flex flex-col sm:-mb-6'>
            <div className='order-1'>
              <FavoritePreviewSkeleton count={favoriteSkeletonCount} />
            </div>
            <div className='order-2 pb-4'>
              <PlaybackStatsSkeleton />
            </div>
            <div className='order-3'>
              <PlaybackHistorySkeleton />
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
