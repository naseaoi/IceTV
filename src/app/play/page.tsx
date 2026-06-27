import { connection } from 'next/server';
import { Suspense } from 'react';

import { PlayLoadingView } from '@/features/play/components/PlayStateViews';

import { PlayPageClient } from './PlayPageClient';

export default async function PlayPage() {
  await connection();

  return (
    <Suspense
      fallback={
        <PlayLoadingView
          loadingStage='searching'
          loadingMessage='正在搜索播放源...'
        />
      }
    >
      <PlayPageClient />
    </Suspense>
  );
}
