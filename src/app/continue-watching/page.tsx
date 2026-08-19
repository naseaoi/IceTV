import { ContinueWatchingPageClient } from '@/features/continue-watching/components/ContinueWatchingPageClient';
import { getContinueWatchingSkeletonCount } from '@/lib/continue-watching.server';

export default async function ContinueWatchingPage() {
  const initialSkeletonCount = await getContinueWatchingSkeletonCount();

  return (
    <ContinueWatchingPageClient initialSkeletonCount={initialSkeletonCount} />
  );
}
