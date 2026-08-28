import HomeClient from '@/features/home/components/HomeClient';
import { getHomeInitialData } from '@/features/home/lib/home.server';
import {
  getContinueWatchingInitialData,
  getContinueWatchingSkeletonCount,
} from '@/lib/continue-watching.server';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [initialData, continueWatchingSkeletonCount, continueWatching] =
    await Promise.all([
      getHomeInitialData(),
      getContinueWatchingSkeletonCount(),
      getContinueWatchingInitialData(),
    ]);

  return (
    <HomeClient
      initialData={initialData}
      continueWatchingSkeletonCount={continueWatchingSkeletonCount}
      continueWatchingRecords={continueWatching.records}
      continueWatchingUpdateCount={continueWatching.updateCount}
    />
  );
}
