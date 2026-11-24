import { MyListsPageClient } from '@/features/lists/components/MyListsPageClient';
import { peekListCountCookie } from '@/lib/list-count-cookies.server';

export default async function MyListsPage() {
  const [count, savedCount] = await Promise.all([
    peekListCountCookie('list_count'),
    peekListCountCookie('saved_list_count'),
  ]);
  return (
    <MyListsPageClient skeletonCount={count} savedSkeletonCount={savedCount} />
  );
}
