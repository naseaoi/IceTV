import {
  ContinueWatchingGridSkeleton,
  ContinueWatchingPageFrame,
  ContinueWatchingToolbarSkeleton,
} from '@/features/continue-watching/components/ContinueWatchingPageFrame';
import { TrackingStripSkeleton } from '@/features/continue-watching/components/TrackingStrip';
import { CONTINUE_WATCHING_PAGE_SIZE } from '@/features/continue-watching/lib/layout';
import { getContinueWatchingSkeletonCount } from '@/lib/continue-watching.server';
import { getListSkeletonCount } from '@/lib/list-count-cookies.server';

// 追更区单行横排，超过一屏宽度的条目看不到，骨架不必画满
const TRACKING_SKELETON_LIMIT = 8;

export default async function ContinueWatchingLoading() {
  const [count, trackingCount] = await Promise.all([
    getContinueWatchingSkeletonCount({
      cookieName: 'cw_page_count',
      limit: CONTINUE_WATCHING_PAGE_SIZE,
    }),
    getListSkeletonCount('cw_tracking_count', TRACKING_SKELETON_LIMIT),
  ]);

  return (
    <ContinueWatchingPageFrame
      toolbar={<ContinueWatchingToolbarSkeleton count={count} />}
    >
      <TrackingStripSkeleton count={trackingCount} />
      <ContinueWatchingGridSkeleton count={count} />
    </ContinueWatchingPageFrame>
  );
}
