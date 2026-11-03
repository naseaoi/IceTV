import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import ScrollableRow from '@/components/ScrollableRow';
import { FavoritePreviewSkeleton } from '@/features/favorites/components/FavoritePreviewSkeleton';
import { MineSection } from '@/features/home/components/MinePageClient';
import { PlaybackStatsSkeleton } from '@/features/playback-stats/components/PlaybackStatsSkeleton';
import { getFavoriteSkeletonCount } from '@/lib/favorites.server';

export default async function MeLoading() {
  const favoriteSkeletonCount = await getFavoriteSkeletonCount();

  return (
    <div className='space-y-4 sm:space-y-6'>
      <MineSection title='最近观看'>
        <ScrollableRow>
          {Array.from({ length: 6 }, (_, index) => (
            <HomePosterCardSkeleton key={index} />
          ))}
        </ScrollableRow>
      </MineSection>
      <MineSection title='我的收藏'>
        <FavoritePreviewSkeleton count={favoriteSkeletonCount} />
      </MineSection>
      <MineSection title='观看统计'>
        <div className='pt-2'>
          <PlaybackStatsSkeleton />
        </div>
      </MineSection>
    </div>
  );
}
