'use client';

import { useEffect, useLayoutEffect, useState } from 'react';

import ContinueWatchingCardSkeleton from '@/components/ContinueWatchingCardSkeleton';
import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import { useClientHydrated } from '@/hooks/useClientHydrated';

import {
  type HomeClientSnapshot,
  getHomeClientSnapshot,
} from '../lib/home-client-cache';
import HomeClient from './HomeClient';
import { HomeHeroSkeleton } from './HomeHero';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function SkeletonRow({
  count,
  mobileContinue = false,
}: {
  count: number;
  mobileContinue?: boolean;
}) {
  return (
    <ScrollableRow>
      {Array.from({ length: count }).map((_, index) =>
        mobileContinue ? (
          <ContinueWatchingCardSkeleton key={index} />
        ) : (
          <HomePosterCardSkeleton key={index} />
        ),
      )}
    </ScrollableRow>
  );
}

function SkeletonSectionHeader() {
  return (
    <div className='mb-4 flex items-center justify-between'>
      <div className='h-7 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
      <div className='h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
    </div>
  );
}

function HomeLoadingSkeleton({
  continueWatchingCount,
}: {
  continueWatchingCount: number;
}) {
  return (
    <PageLayout transparentTopNav>
      <HomeHeroSkeleton />
      <div className='overflow-visible pb-2 pt-4 md:pt-2'>
        <div className={PAGE_CONTAINER_CLASS}>
          {continueWatchingCount > 0 && (
            <section className='mb-2'>
              <SkeletonSectionHeader />
              <SkeletonRow count={continueWatchingCount} mobileContinue />
            </section>
          )}

          <section className='mb-2'>
            <SkeletonSectionHeader />
            <SkeletonRow count={12} />
          </section>

          <section className='mb-2'>
            <SkeletonSectionHeader />
            <SkeletonRow count={12} />
          </section>

          <section className='mb-2'>
            <SkeletonSectionHeader />
            <SkeletonRow count={12} />
          </section>

          <section className='mb-2'>
            <SkeletonSectionHeader />
            <SkeletonRow count={12} />
          </section>
        </div>
      </div>
    </PageLayout>
  );
}

export default function HomeRouteLoading({
  continueWatchingCount,
}: {
  continueWatchingCount: number;
}) {
  const clientHydrated = useClientHydrated();
  const [snapshot, setSnapshot] = useState<HomeClientSnapshot | null>(() =>
    clientHydrated ? getHomeClientSnapshot() : null,
  );

  useIsomorphicLayoutEffect(() => {
    setSnapshot(getHomeClientSnapshot());
  }, []);

  if (!snapshot) {
    return (
      <HomeLoadingSkeleton continueWatchingCount={continueWatchingCount} />
    );
  }

  return (
    <HomeClient
      initialData={snapshot.initialData}
      continueWatchingSkeletonCount={snapshot.continueWatchingSkeletonCount}
      routeFallback
    />
  );
}
