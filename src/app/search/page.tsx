import { Suspense } from 'react';

import SearchPageClient from '@/features/search/components/SearchPageClient';
import { SearchPageSkeleton } from '@/features/search/components/SearchPageSkeleton';

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchPageSkeleton />}>
      <SearchPageClient />
    </Suspense>
  );
}
