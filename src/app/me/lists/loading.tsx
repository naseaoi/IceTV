import { MyListsPageSkeleton } from '@/features/lists/components/MyListsPageClient';
import { getListSkeletonCount } from '@/lib/list-count-cookies.server';

export default async function MyListsLoading() {
  const count = await getListSkeletonCount('list_count');
  return <MyListsPageSkeleton skeletonCount={count} />;
}
