import { Suspense } from 'react';

import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import { DoubanFeedLoading } from '@/features/douban/components/DoubanFeedLoading';
import { DoubanFilterBar } from '@/features/douban/components/DoubanFilterBar';
import { DoubanPageClient } from '@/features/douban/components/DoubanPageClient';
import {
  getDoubanActivePath,
  normalizeDoubanType,
} from '@/features/douban/lib/pageMeta';

function DoubanPageFallback({ type }: { type: string }) {
  return (
    <PageLayout activePath={getDoubanActivePath(type)}>
      <DoubanFilterBar>
        <div className='flex gap-2'>
          {[64, 220, 180].map((width) => (
            <div
              key={width}
              style={{ width }}
              className='h-9 rounded-full bg-gray-900/[0.05] dark:bg-white/[0.06]'
            />
          ))}
        </div>
      </DoubanFilterBar>
      <div className={`${PAGE_CONTAINER_CLASS} pb-8 pt-1 md:pt-6`}>
        <DoubanFeedLoading />
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
