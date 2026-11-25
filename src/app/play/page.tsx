import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { PlayLoadingView } from '@/features/play/components/PlayStateViews';
import { getInitialDanmakuEnabled } from '@/features/play/lib/danmaku/preference.server';
import { PlayPageClient } from '@/features/play/PlayPageClient';
import { getConfigForRead } from '@/lib/config';
import { isAdultSourceBlocked } from '@/lib/yellow';

export default async function PlayPage({
  searchParams,
}: {
  searchParams?: Promise<{ source?: string | string[] }>;
} = {}) {
  await connection();
  const config = await getConfigForRead();
  const source = (await searchParams)?.source;
  if (
    typeof source === 'string' &&
    isAdultSourceBlocked(
      config.SourceConfig.find((site) => site.key === source),
      config.SiteConfig.DisableYellowFilter,
    )
  )
    notFound();
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
