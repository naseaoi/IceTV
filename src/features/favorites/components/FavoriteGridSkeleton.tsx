import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import { POSTER_GRID_CLASS } from '@/components/poster-grid-layout';

export function FavoriteGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={POSTER_GRID_CLASS}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className='w-full'>
          <HomePosterCardSkeleton className='w-full' />
        </div>
      ))}
    </div>
  );
}
