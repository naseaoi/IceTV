import { ListPlazaPageSkeleton } from '@/features/lists/components/ListPlazaPageClient';
import { peekListCountCookie } from '@/lib/list-count-cookies.server';

export default async function ListPlazaLoading() {
  return (
    <ListPlazaPageSkeleton
      knownTotal={await peekListCountCookie('plaza_count')}
    />
  );
}
