'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { SECTION_HEADER_CLASS } from '@/components/section-header';
import { FavoritePreviewSection } from '@/features/favorites/components/FavoritePreviewSection';
import { useFavoriteItems } from '@/features/favorites/hooks/useFavoriteItems';
import { PlaybackHistoryPreview } from '@/features/playback-stats/components/PlaybackHistoryPreview';
import { PlaybackStatsPanel } from '@/features/playback-stats/components/PlaybackStatsPanel';

// 概览页与其骨架共用
export const MINE_OVERVIEW_CLASS = 'space-y-4 sm:space-y-6';

export function MineSection({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className={SECTION_HEADER_CLASS}>
        <h2 className='text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100'>
          {title}
        </h2>
        {href && (
          <Link
            href={href}
            className='flex items-center text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
          >
            更多
            <ChevronRight className='ml-0.5 h-4 w-4' />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function MinePageClient({
  favoriteSkeletonCount = 0,
  historySkeletonCount = 0,
}: {
  favoriteSkeletonCount?: number;
  historySkeletonCount?: number;
}) {
  const {
    favoriteItems,
    total: favoriteTotal,
    loading: favoritesLoading,
    skeletonCount: favoriteLoadingSkeletonCount,
  } = useFavoriteItems(favoriteSkeletonCount);

  return (
    <div className={MINE_OVERVIEW_CLASS}>
      <MineSection title='最近观看' href='/me/history'>
        <PlaybackHistoryPreview initialSkeletonCount={historySkeletonCount} />
      </MineSection>
      <MineSection title='我的收藏' href='/me/favorites'>
        <FavoritePreviewSection
          items={favoriteItems}
          total={favoriteTotal}
          loading={favoritesLoading}
          skeletonCount={favoriteLoadingSkeletonCount}
        />
      </MineSection>
      <PlaybackStatsPanel />
    </div>
  );
}
