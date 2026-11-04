// 覆盖 1680px 容器内的首屏与右侧露出的下一张，和真实横排共用挂载批量。
export const HOME_RECOMMENDATION_INITIAL_COUNT = 10;

export const HOME_POSTER_CARD_CLASS =
  'home-poster-card w-[25vw] min-w-[25vw] sm:w-40 sm:min-w-[160px]';

interface HomePosterCardSkeletonProps {
  className?: string;
  subtitle?: boolean;
  variant?: 'poster' | 'video';
}

export default function HomePosterCardSkeleton({
  className = HOME_POSTER_CARD_CLASS,
  subtitle = false,
  variant = 'video',
}: HomePosterCardSkeletonProps) {
  return (
    <div className={className}>
      <div className='group relative w-full rounded-lg bg-transparent'>
        <div className='skeleton relative aspect-[2/3] overflow-hidden rounded-lg' />
        <div
          className={`mt-2 flex items-center text-[13px] ${variant === 'poster' && !subtitle ? 'h-5' : 'h-[1.5em]'}`}
        >
          <div className='skeleton h-3.5 w-3/4 rounded' />
        </div>
        {subtitle && (
          <div className='mt-0.5 flex h-4 items-center'>
            <div className='skeleton h-3 w-1/2 rounded' />
          </div>
        )}
      </div>
    </div>
  );
}
