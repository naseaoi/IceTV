export const HOME_POSTER_CARD_CLASS =
  'w-[25vw] min-w-[25vw] sm:w-44 sm:min-w-[180px]';

interface HomePosterCardSkeletonProps {
  withSubtitle?: boolean;
}

export default function HomePosterCardSkeleton({
  withSubtitle = false,
}: HomePosterCardSkeletonProps) {
  return (
    <div className={HOME_POSTER_CARD_CLASS}>
      <div className='group relative w-full rounded-lg bg-transparent'>
        <div className='relative aspect-[2/3] overflow-hidden rounded-lg bg-gray-200 dark:bg-gray-800'>
          <div className='absolute inset-0 animate-pulse bg-gray-300 dark:bg-gray-700' />
        </div>
        <div className='mt-2 text-center'>
          <div className='mx-auto h-5 w-4/5 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          {withSubtitle && (
            <div className='mx-auto mt-1 h-[22px] w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          )}
        </div>
      </div>
    </div>
  );
}
