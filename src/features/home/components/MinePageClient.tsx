'use client';

import { BarChart3, History, Star } from 'lucide-react';
import Link from 'next/link';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';
import PageLayout from '@/components/PageLayout';
import { FavoritePreviewSection } from '@/features/favorites/components/FavoritePreviewSection';
import { useFavoriteItems } from '@/features/favorites/hooks/useFavoriteItems';
import { PlaybackHistorySection } from '@/features/playback-stats/components/PlaybackHistorySection';
import { PlaybackStatsPanel } from '@/features/playback-stats/components/PlaybackStatsPanel';

import { HomeMineSwitch } from './HomeMineSwitch';

function QuickEntry({
  icon: Icon,
  label,
  href,
  onClick,
}: {
  icon: typeof Star;
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <Icon className='h-5 w-5 text-green-600 dark:text-green-400' />
      <span className='text-xs text-gray-700 dark:text-gray-200'>{label}</span>
    </>
  );
  const className =
    'flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-gray-200/60 bg-white transition-colors hover:bg-gray-50 dark:border-gray-700/60 dark:bg-gray-800/60 dark:hover:bg-gray-800';

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type='button' onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function AuthenticatedMinePageClient({
  favoriteSkeletonCount = 0,
}: {
  favoriteSkeletonCount?: number;
}) {
  const {
    favoriteItems,
    loading: favoritesLoading,
    skeletonCount: favoriteLoadingSkeletonCount,
  } = useFavoriteItems(true, favoriteSkeletonCount);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <PageLayout activePath='/'>
      <div className='overflow-visible px-2 pb-2 pt-4 sm:px-10 sm:pt-8'>
        <div className='mb-4 hidden justify-center md:flex'>
          <HomeMineSwitch active='mine' />
        </div>

        <div className='mx-auto max-w-[95%]'>
          <div className='mb-4 flex gap-3 md:hidden'>
            <QuickEntry icon={Star} label='收藏' href='/me/favorites' />
            <QuickEntry
              icon={BarChart3}
              label='统计'
              onClick={() => scrollToSection('mine-stats')}
            />
            <QuickEntry
              icon={History}
              label='历史'
              onClick={() => scrollToSection('mine-history')}
            />
          </div>

          <div className='-mb-3 flex flex-col sm:-mb-6'>
            <div className='order-1'>
              <FavoritePreviewSection
                items={favoriteItems}
                loading={favoritesLoading}
                skeletonCount={favoriteLoadingSkeletonCount}
              />
            </div>

            <div id='mine-stats' className='order-2 pb-4'>
              <PlaybackStatsPanel />
            </div>

            <div id='mine-history' className='order-3'>
              <PlaybackHistorySection />
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export function MinePageClient({
  favoriteSkeletonCount = 0,
}: {
  favoriteSkeletonCount?: number;
}) {
  return (
    <AuthenticatedRoute activePath='/me' message='请先登录后再查看个人数据。'>
      <AuthenticatedMinePageClient
        favoriteSkeletonCount={favoriteSkeletonCount}
      />
    </AuthenticatedRoute>
  );
}
