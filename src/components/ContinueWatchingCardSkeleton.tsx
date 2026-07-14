import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import MobileContinueCardSkeleton from '@/components/MobileContinueCardSkeleton';

export default function ContinueWatchingCardSkeleton() {
  return (
    <div className='shrink-0'>
      <div className='md:hidden'>
        <MobileContinueCardSkeleton />
      </div>
      <div className='hidden md:block'>
        <HomePosterCardSkeleton withSubtitle />
      </div>
    </div>
  );
}
