import { MyReviewsPageSkeleton } from '@/features/profile/MyReviewsPageClient';
import { getListSkeletonCount } from '@/lib/list-count-cookies.server';
import { MY_REVIEWS_PAGE_SIZE } from '@/lib/video-reviews';

export default async function MyReviewsLoading() {
  const count = await getListSkeletonCount(
    'review_count',
    MY_REVIEWS_PAGE_SIZE,
  );
  return <MyReviewsPageSkeleton initialCount={count} />;
}
