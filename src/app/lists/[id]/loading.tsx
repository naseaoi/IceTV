'use client';

import { useParams } from 'next/navigation';

import { ListDetailPageSkeleton } from '@/features/lists/components/ListDetailPageClient';

export default function ListDetailLoading() {
  const { id } = useParams<{ id: string }>();
  return <ListDetailPageSkeleton listId={id} />;
}
