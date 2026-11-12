import {
  ContinueWatchingGridSkeleton,
  ContinueWatchingPageFrame,
  ContinueWatchingToolbarSkeleton,
} from '@/features/continue-watching/components/ContinueWatchingPageFrame';
import { CONTINUE_WATCHING_PAGE_SIZE } from '@/features/continue-watching/lib/layout';
import { getContinueWatchingSkeletonCount } from '@/lib/continue-watching.server';

export default async function ContinueWatchingLoading() {
  const count = await getContinueWatchingSkeletonCount({
    cookieName: 'cw_page_count',
    limit: CONTINUE_WATCHING_PAGE_SIZE,
  });

  return (
    <ContinueWatchingPageFrame
      toolbar={<ContinueWatchingToolbarSkeleton count={count} />}
    >
      <ContinueWatchingGridSkeleton count={count} />
    </ContinueWatchingPageFrame>
  );
}
