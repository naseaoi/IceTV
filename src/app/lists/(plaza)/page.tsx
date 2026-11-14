import { ListPlazaPageClient } from '@/features/lists/components/ListPlazaPageClient';
import { getPlazaSkeletonCount } from '@/features/lists/lib/list-skeleton-counts.server';

export default async function ListPlazaPage() {
  return <ListPlazaPageClient initialTotal={await getPlazaSkeletonCount()} />;
}
