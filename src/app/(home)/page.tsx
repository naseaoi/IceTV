import HomeClient from '@/features/home/components/HomeClient';
import { getContinueWatchingSkeletonCount } from '@/lib/continue-watching.server';
import { HOME_RECOMMENDATION_REVALIDATE_SECONDS } from '@/lib/home-cache';
import { getHomeInitialData } from '@/lib/home.server';

export const revalidate = HOME_RECOMMENDATION_REVALIDATE_SECONDS;

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
