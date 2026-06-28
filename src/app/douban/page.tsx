import { Suspense } from 'react';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import PageLayout from '@/components/PageLayout';
import { DoubanPageClient } from '@/features/douban/components/DoubanPageClient';

function DoubanPageFallback() {
  const skeletonData = Array.from({ length: 25 }, (_, index) => index);

  return (
    <PageLayout activePath='/douban?type=movie'>
      <div className='overflow-visible px-4 py-4 sm:px-10 sm:py-8'>
        <div className='mx-auto max-w-[95%]'>
          <div className='mb-6 space-y-4 sm:mb-8 sm:space-y-6'>
            <div>
              <div className='mb-1 h-8 w-28 rounded bg-gray-200/70 dark:bg-gray-800/70 sm:mb-2 sm:h-9' />
              <div className='h-5 w-40 rounded bg-gray-200/60 dark:bg-gray-800/60' />
            </div>
            <div className='h-[154px] rounded-2xl border border-gray-200/30 bg-white/60 p-4 backdrop-blur-sm dark:border-gray-700/30 dark:bg-gray-800/40 sm:p-6' />
          </div>

          <div className='mt-8 overflow-visible'>
            <div className='grid grid-cols-3 justify-start gap-x-2 gap-y-12 px-0 sm:grid-cols-[repeat(auto-fill,_180px)] sm:gap-x-6 sm:gap-y-20 sm:px-2'>
              {skeletonData.map((index) => (
                <div key={index} className='w-24 sm:w-[180px]'>
                  <DoubanCardSkeleton />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default function DoubanPage() {
  return (
    <Suspense fallback={<DoubanPageFallback />}>
      <DoubanPageClient />
    </Suspense>
  );
}
