import { ListDetailPageClient } from '@/features/lists/components/ListDetailPageClient';
import { getListDetailSkeletonCount } from '@/features/lists/lib/list-skeleton-counts.server';

export default async function ListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <ListDetailPageClient
      key={id}
      listId={id}
      initialItemCount={await getListDetailSkeletonCount(id)}
    />
  );
}
