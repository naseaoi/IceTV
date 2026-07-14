import { SlidersHorizontal } from 'lucide-react';
import { Suspense } from 'react';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import PageLayout from '@/components/PageLayout';
import { DoubanPageClient } from '@/features/douban/components/DoubanPageClient';
import {
  DOUBAN_GRID_CLASS,
  DOUBAN_GRID_ITEM_CLASS,
  DOUBAN_GRID_WRAPPER_CLASS,
} from '@/features/douban/lib/grid-layout';
import {
  getDoubanActivePath,
  getDoubanPageTitle,
  normalizeDoubanType,
} from '@/features/douban/lib/pageMeta';

function DoubanPageFallback({ type }: { type: string }) {
  const skeletonData = Array.from({ length: 25 }, (_, index) => index);

  return (
    <PageLayout
      activePath={getDoubanActivePath(type)}
      mobileHeader={{
        title: getDoubanPageTitle(type),
        showBack: true,
        actions: (
          <button
            type='button'
            aria-label='筛选加载中'
            disabled
            className='flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-gray-700 dark:text-gray-200'
          >
            <SlidersHorizontal className='h-4 w-4' />
            筛选
          </button>
        ),
      }}
    >
      <div className='overflow-visible px-4 py-4 sm:px-10 sm:py-8'>
        <div className='mx-auto max-w-[95%]'>
          <div className='mb-4 space-y-3 sm:mb-8 sm:space-y-6'>
            <div className='hidden h-9 w-28 rounded bg-gray-200/70 dark:bg-gray-800/70 sm:block' />
            <div className='hidden h-5 w-40 rounded bg-gray-200/60 dark:bg-gray-800/60 sm:block' />
            <div className='h-5 w-40 rounded bg-gray-200/60 dark:bg-gray-800/60 sm:hidden' />
            <div className='hidden h-[154px] rounded-2xl border border-gray-200/30 bg-white/60 p-4 backdrop-blur-sm dark:border-gray-700/30 dark:bg-gray-800/40 sm:block sm:p-6' />
          </div>

          <div className='mt-8 overflow-visible'>
            <div className={DOUBAN_GRID_WRAPPER_CLASS}>
              <div className={DOUBAN_GRID_CLASS}>
                {skeletonData.map((index) => (
                  <div key={index} className={DOUBAN_GRID_ITEM_CLASS}>
                    <DoubanCardSkeleton />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default async function DoubanPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const params = await searchParams;
  const type = normalizeDoubanType(params.type);

  return (
    <Suspense fallback={<DoubanPageFallback type={type} />}>
      <DoubanPageClient />
    </Suspense>
  );
}
