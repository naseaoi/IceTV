import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import ScrollableRow from '@/components/ScrollableRow';

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
      <ScrollableRow>
        {Array.from({ length: 6 }).map((_, index) => (
          <HomePosterCardSkeleton key={index} withSubtitle />
        ))}
      </ScrollableRow>
    </section>
  );
}
