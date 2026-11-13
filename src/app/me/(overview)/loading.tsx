import { FavoritePreviewSkeleton } from '@/features/favorites/components/FavoritePreviewSkeleton';
import {
  CAPSULE_SECTION_TITLE,
  MINE_OVERVIEW_CLASS,
  MineSection,
} from '@/features/home/components/MinePageClient';
import { PlaybackHistoryPreviewSkeleton } from '@/features/playback-stats/components/PlaybackHistoryPreview';
import { PlaybackStatsSkeleton } from '@/features/playback-stats/components/PlaybackStatsSkeleton';
import { CapsuleSectionSkeleton } from '@/features/time-capsule/components/CapsuleSection';
import { getCapsuleCountsForCurrentUser } from '@/features/time-capsule/counts.server';
import { getFavoriteSkeletonCount } from '@/lib/favorites.server';
import { getListSkeletonCount } from '@/lib/list-count-cookies.server';

export default async function MeLoading() {
  const [favoriteSkeletonCount, historySkeletonCount, capsuleCounts] =
    await Promise.all([
      getFavoriteSkeletonCount(),
      getListSkeletonCount('history_count'),
      getCapsuleCountsForCurrentUser(),
    ]);
  const capsuleRows = capsuleCounts.pending + capsuleCounts.delivered;

  return (
    <div className={MINE_OVERVIEW_CLASS}>
      <MineSection title='最近观看' href='/me/history'>
        <PlaybackHistoryPreviewSkeleton initialCount={historySkeletonCount} />
      </MineSection>
      <MineSection title='我的收藏' href='/me/favorites'>
        <FavoritePreviewSkeleton count={favoriteSkeletonCount} />
      </MineSection>
      {capsuleRows > 0 && (
        <MineSection title={CAPSULE_SECTION_TITLE}>
          <CapsuleSectionSkeleton counts={capsuleCounts} />
        </MineSection>
      )}
      <PlaybackStatsSkeleton />
    </div>
  );
}
