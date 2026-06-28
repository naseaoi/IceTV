import { Suspense } from 'react';

import PageLayout from '@/components/PageLayout';
import SearchPageClient from '@/features/search/components/SearchPageClient';

function SearchPageSkeleton() {
  return (
    <PageLayout activePath='/search'>
      <div className='mb-10 overflow-visible px-4 py-4 sm:px-10 sm:py-8'>
        <div className='mb-8'>
          <div className='mx-auto max-w-2xl'>
            <div className='h-12 w-full rounded-lg border border-gray-200/50 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-800' />
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchPageSkeleton />}>
      <SearchPageClient />
    </Suspense>
  );
}
