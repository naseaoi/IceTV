'use client';

import { BarChart3, ChevronDown, History, Star } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import PageLayout from '@/components/PageLayout';
import { FavoritePreviewSection } from '@/features/favorites/components/FavoritePreviewSection';
import { useFavoriteItems } from '@/features/favorites/hooks/useFavoriteItems';
import { PlaybackHistorySection } from '@/features/playback-stats/components/PlaybackHistorySection';
import { PlaybackStatsPanel } from '@/features/playback-stats/components/PlaybackStatsPanel';

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

export function MinePageClient({
  favoriteSkeletonCount = 0,
}: {
  favoriteSkeletonCount?: number;
}) {
  const {
    favoriteItems,
    loading: favoritesLoading,
    skeletonCount: favoriteLoadingSkeletonCount,
  } = useFavoriteItems(true, favoriteSkeletonCount);
  const [statsOpen, setStatsOpen] = useState(false);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <PageLayout activePath='/'>
      <div className='overflow-visible px-2 pb-2 pt-4 sm:px-10 sm:pt-8'>
        <div className='mx-auto max-w-[95%]'>
          <div className='mb-4 flex gap-3 md:hidden'>
            <QuickEntry icon={Star} label='收藏' href='/me/favorites' />
            <QuickEntry
              icon={History}
              label='历史'
              onClick={() => scrollToSection('mine-history')}
            />
            <QuickEntry
              icon={BarChart3}
              label='统计'
              onClick={() => {
                setStatsOpen(true);
                requestAnimationFrame(() => scrollToSection('mine-stats'));
              }}
            />
          </div>

          <div className='-mb-8 flex flex-col sm:-mb-10'>
            <div className='order-1'>
              <FavoritePreviewSection
                items={favoriteItems}
                loading={favoritesLoading}
                skeletonCount={favoriteLoadingSkeletonCount}
              />
            </div>

            <div id='mine-history' className='order-2 md:order-3'>
              <PlaybackHistorySection />
            </div>

            <div id='mine-stats' className='order-3 md:order-2'>
              <button
                type='button'
                className='flex w-full items-center justify-between py-2 text-left md:hidden'
                aria-expanded={statsOpen}
                onClick={() => setStatsOpen((prev) => !prev)}
              >
                <span className='flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-gray-200'>
                  <BarChart3 className='h-5 w-5 text-sky-500' />
                  观看统计
                </span>
                <ChevronDown
                  className={`h-5 w-5 text-gray-500 transition-transform ${
                    statsOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              <div className={statsOpen ? '' : 'hidden md:block'}>
                <PlaybackStatsPanel />
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
