import { Suspense } from 'react';

import PageLayout from '@/components/PageLayout';
import SearchPageClient from '@/features/search/components/SearchPageClient';

function SearchPageSkeleton() {
  return (
    <PageLayout activePath='/search'>
      <div className='overflow-visible px-4 py-4 sm:px-10 sm:py-8'>
        <div className='pt-[20vh]'>
          <div className='mx-auto w-full max-w-2xl'>
            <div className='h-12 w-full rounded-lg border border-gray-200/50 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-800' />
          </div>
          <div className='mx-auto mt-8 w-full max-w-2xl'>
            <div className='mx-auto h-[120px] w-full'>
              <div className='mx-auto mb-4 h-8 w-32 rounded bg-gray-200/50 dark:bg-gray-700/50' />
              <div className='flex flex-wrap justify-center gap-2'>
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className='h-8 w-20 rounded-full bg-gray-200/50 dark:bg-gray-700/50'
                  />
                ))}
              </div>
            </div>
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
