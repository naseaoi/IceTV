import HomeClient from '@/features/home/components/HomeClient';
import { getContinueWatchingSkeletonCount } from '@/lib/continue-watching.server';
import { getHomeInitialData } from '@/features/home/lib/home.server';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [initialData, continueWatchingSkeletonCount] = await Promise.all([
    getHomeInitialData(),
    getContinueWatchingSkeletonCount(),
  ]);

  return (
    <HomeClient
      initialData={initialData}
      continueWatchingSkeletonCount={continueWatchingSkeletonCount}
    />
  );
}
