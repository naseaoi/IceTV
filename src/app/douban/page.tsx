import { Suspense } from 'react';

import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import { DoubanFeedLoading } from '@/features/douban/components/DoubanFeedLoading';
import {
  DoubanFilterBar,
  DoubanFilterLoading,
} from '@/features/douban/components/DoubanFilterBar';
import { DoubanPageClient } from '@/features/douban/components/DoubanPageClient';
import {
  getDoubanActivePath,
  normalizeDoubanType,
} from '@/features/douban/lib/pageMeta';

function DoubanPageFallback({ type }: { type: string }) {
  return (
    <PageLayout activePath={getDoubanActivePath(type)}>
      <DoubanFilterBar>
        <DoubanFilterLoading type={type} />
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
