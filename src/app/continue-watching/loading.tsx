import SkeletonText from '@/components/SkeletonText';
import {
  ContinueWatchingGridSkeleton,
  ContinueWatchingPageFrame,
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
      total={null}
      action={
        <SkeletonText className='text-sm' barClassName='h-4 w-7 rounded' />
      }
    >
      <ContinueWatchingGridSkeleton count={count} />
    </ContinueWatchingPageFrame>
  );
}
