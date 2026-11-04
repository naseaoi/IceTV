import { ContinueWatchingPageClient } from '@/features/continue-watching/components/ContinueWatchingPageClient';
import { CONTINUE_WATCHING_PAGE_SIZE } from '@/features/continue-watching/lib/layout';
import { getContinueWatchingSkeletonCount } from '@/lib/continue-watching.server';

export default async function ContinueWatchingPage() {
  const initialSkeletonCount = await getContinueWatchingSkeletonCount({
    cookieName: 'cw_page_count',
    limit: CONTINUE_WATCHING_PAGE_SIZE,
  });

  return (
    <ContinueWatchingPageClient initialSkeletonCount={initialSkeletonCount} />
  );
}
