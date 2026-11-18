import { MyListsPageClient } from '@/features/lists/components/MyListsPageClient';
import { getListSkeletonCount } from '@/lib/list-count-cookies.server';

export default async function MyListsPage() {
  const count = await getListSkeletonCount('list_count');
  return <MyListsPageClient skeletonCount={count} />;
}
