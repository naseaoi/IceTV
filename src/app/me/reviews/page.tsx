import MyReviewsPageClient from '@/features/profile/MyReviewsPageClient';
import { getListSkeletonCount } from '@/lib/list-count-cookies.server';
import { MY_REVIEWS_PAGE_SIZE } from '@/lib/video-reviews';

export default async function MyReviewsPage() {
  const count = await getListSkeletonCount(
    'review_count',
    MY_REVIEWS_PAGE_SIZE,
  );
  return <MyReviewsPageClient initialSkeletonCount={count} />;
}
