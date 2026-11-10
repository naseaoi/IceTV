import { ContinueWatchingPageClient } from '@/features/continue-watching/components/ContinueWatchingPageClient';
import {
  CONTINUE_WATCHING_PAGE_SIZE,
  parseContinueWatchingFilter,
} from '@/features/continue-watching/lib/layout';
import { getContinueWatchingPageData } from '@/lib/continue-watching.server';

export default async function ContinueWatchingPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[] }>;
}) {
  const [params, data] = await Promise.all([
    searchParams,
    getContinueWatchingPageData(CONTINUE_WATCHING_PAGE_SIZE),
  ]);

  const filter = parseContinueWatchingFilter(params.filter);
  const filterCount = filter === 'all' ? null : data.counts[filter];
  const skeletonCount =
    filterCount !== null
      ? Math.min(filterCount, CONTINUE_WATCHING_PAGE_SIZE)
      : data.skeletonCount;

  return (
    <ContinueWatchingPageClient
      initialSkeletonCount={skeletonCount}
      initialCounts={data.counts}
    />
  );
}
