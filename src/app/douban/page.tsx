import { Suspense } from 'react';

import { DoubanPageClient } from '@/features/douban/components/DoubanPageClient';

export default function DoubanPage() {
  return (
    <Suspense>
      <DoubanPageClient />
    </Suspense>
  );
}
