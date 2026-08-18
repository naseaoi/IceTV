import HomeRouteLoading from '@/features/home/components/HomeRouteLoading';
import { getContinueWatchingSkeletonCount } from '@/lib/continue-watching.server';

export default async function HomeLoading() {
  const continueWatchingCount = await getContinueWatchingSkeletonCount();

  return <HomeRouteLoading continueWatchingCount={continueWatchingCount} />;
}
