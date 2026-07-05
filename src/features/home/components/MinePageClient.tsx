'use client';

import PageLayout from '@/components/PageLayout';
import { FavoritePreviewSection } from '@/features/favorites/components/FavoritePreviewSection';
import { useFavoriteItems } from '@/features/favorites/hooks/useFavoriteItems';
import { PlaybackHistorySection } from '@/features/playback-stats/components/PlaybackHistorySection';
import { PlaybackStatsPanel } from '@/features/playback-stats/components/PlaybackStatsPanel';

import { HomeMineSwitch } from './HomeMineSwitch';

export function MinePageClient() {
  const { favoriteItems, loading: favoritesLoading } = useFavoriteItems(true);

  return (
    <PageLayout activePath='/'>
      <div className='overflow-visible px-2 pb-2 pt-4 sm:px-10 sm:pt-8'>
        <div className='mb-4 flex justify-center'>
          <HomeMineSwitch active='mine' />
        </div>

        <div className='mx-auto max-w-[95%]'>
          <div className='-mb-8 sm:-mb-10'>
            <FavoritePreviewSection
              items={favoriteItems}
              loading={favoritesLoading}
            />
            <PlaybackStatsPanel />
            <PlaybackHistorySection />
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
