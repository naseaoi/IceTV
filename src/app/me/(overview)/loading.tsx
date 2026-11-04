import { FavoritePreviewSkeleton } from '@/features/favorites/components/FavoritePreviewSkeleton';
import {
  MINE_OVERVIEW_CLASS,
  MineSection,
} from '@/features/home/components/MinePageClient';
import { PlaybackHistoryPreviewSkeleton } from '@/features/playback-stats/components/PlaybackHistoryPreview';
import { PlaybackStatsSkeleton } from '@/features/playback-stats/components/PlaybackStatsSkeleton';
import { getFavoriteSkeletonCount } from '@/lib/favorites.server';

export default async function MeLoading() {
  const favoriteSkeletonCount = await getFavoriteSkeletonCount();

  return (
    <div className={MINE_OVERVIEW_CLASS}>
      <MineSection title='最近观看' href='/me/history'>
        <PlaybackHistoryPreviewSkeleton />
      </MineSection>
      <MineSection title='我的收藏' href='/me/favorites'>
        <FavoritePreviewSkeleton count={favoriteSkeletonCount} />
      </MineSection>
      <PlaybackStatsSkeleton />
    </div>
  );
}
