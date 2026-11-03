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
          <HomePosterCardSkeleton key={index} variant='poster' />
        ),
      )}
    </ScrollableRow>
  );
}

function SkeletonSectionHeader() {
  return (
    <div className='mb-1 flex items-baseline justify-between sm:mb-2'>
      <div className='skeleton h-7 w-28 rounded' />
      <div className='skeleton h-5 w-16 rounded' />
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
          <div className='-mb-3 space-y-2 sm:-mb-6 sm:space-y-4'>
            {continueWatchingCount > 0 && (
              <section className='mb-2'>
                <SkeletonSectionHeader />
                <SkeletonRow count={continueWatchingCount} mobileContinue />
              </section>
            )}

            <section className='mb-2'>
              <SkeletonSectionHeader />
              <SkeletonRow count={8} />
            </section>

            <section className='mb-2'>
              <SkeletonSectionHeader />
              <SkeletonRow count={8} />
            </section>

            <section className='mb-2'>
              <SkeletonSectionHeader />
              <SkeletonRow count={8} />
            </section>

            <section className='mb-2'>
              <SkeletonSectionHeader />
              <SkeletonRow count={8} />
            </section>
          </div>
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
