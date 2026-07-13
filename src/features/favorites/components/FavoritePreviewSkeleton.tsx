import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';

export function FavoritePreviewSkeleton() {
  return (
    <section className='mb-2'>
      <div className='mb-4 flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <div className='h-5 w-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          <div className='h-7 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        </div>
        <div className='h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
      </div>
      <div className='relative'>
        <div className='scrollbar-hide flex space-x-3 overflow-x-auto py-1 pb-3 pl-1 pr-4 sm:space-x-7 sm:py-2 sm:pb-6 sm:pr-6'>
          {Array.from({ length: 6 }).map((_, index) => (
            <HomePosterCardSkeleton key={index} withSubtitle />
          ))}
        </div>
      </div>
    </section>
  );
}
