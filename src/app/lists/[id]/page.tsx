import { ListDetailPageClient } from '@/features/lists/components/ListDetailPageClient';

export default async function ListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ListDetailPageClient key={id} listId={id} />;
}
