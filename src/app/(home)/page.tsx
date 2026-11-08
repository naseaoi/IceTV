import HomeClient from '@/features/home/components/HomeClient';
import { getHomeInitialData } from '@/features/home/lib/home.server';
import { isLikelyMobileRequest } from '@/features/home/lib/request-viewport.server';
import {
  getContinueWatchingInitialData,
  getContinueWatchingSkeletonCount,
} from '@/lib/continue-watching.server';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [
    initialData,
    continueWatchingSkeletonCount,
    continueWatching,
    likelyMobile,
  ] = await Promise.all([
    getHomeInitialData(),
    getContinueWatchingSkeletonCount(),
    getContinueWatchingInitialData(),
    isLikelyMobileRequest(),
  ]);

  return (
    <HomeClient
      initialData={initialData}
      likelyMobile={likelyMobile}
      continueWatchingSkeletonCount={continueWatchingSkeletonCount}
      continueWatchingRecords={continueWatching.records}
      continueWatchingUpdateCount={continueWatching.updateCount}
    />
  );
}
