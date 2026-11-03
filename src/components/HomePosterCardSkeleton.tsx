export const HOME_POSTER_CARD_CLASS =
  'home-poster-card w-[25vw] min-w-[25vw] sm:w-40 sm:min-w-[160px]';

interface HomePosterCardSkeletonProps {
  className?: string;
}

export default function HomePosterCardSkeleton({
  className = HOME_POSTER_CARD_CLASS,
}: HomePosterCardSkeletonProps) {
  return (
    <div className={className}>
      <div className='group relative w-full rounded-lg bg-transparent'>
        <div className='relative aspect-[2/3] overflow-hidden rounded-lg bg-gray-200 dark:bg-gray-800'>
          <div className='absolute inset-0 animate-pulse bg-gray-300 dark:bg-gray-700' />
        </div>
        <div className='mt-2 flex h-5 items-center'>
          <div className='h-3.5 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
        </div>
      </div>
    </div>
  );
}
