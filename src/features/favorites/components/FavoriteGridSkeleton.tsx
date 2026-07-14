import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import { FAVORITE_GRID_CLASS } from '@/features/favorites/components/FavoriteGrid';

export function FavoriteGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={FAVORITE_GRID_CLASS}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className='w-full sm:w-[180px]'>
          <HomePosterCardSkeleton className='w-full' withSubtitle />
        </div>
      ))}
    </div>
  );
}
