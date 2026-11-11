import { connection } from 'next/server';
import { Suspense } from 'react';

import { PlayLoadingView } from '@/features/play/components/PlayStateViews';
import { getInitialDanmakuEnabled } from '@/features/play/lib/danmaku/preference.server';
import { PlayPageClient } from '@/features/play/PlayPageClient';
import { getConfigForRead } from '@/lib/config';

export default async function PlayPage() {
  await connection();
  const config = await getConfigForRead();
  const initialDanmakuEnabled = config.SiteConfig.EnableDanmaku
    ? await getInitialDanmakuEnabled()
    : null;

  return (
    <Suspense
      fallback={
        <PlayLoadingView
          loadingStage='searching'
          loadingMessage='正在搜索播放源...'
        />
      }
    >
      <PlayPageClient initialDanmakuEnabled={initialDanmakuEnabled} />
    </Suspense>
  );
}
