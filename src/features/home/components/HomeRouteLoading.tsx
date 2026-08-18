'use client';

import { useEffect, useLayoutEffect, useState } from 'react';

import ContinueWatchingCardSkeleton from '@/components/ContinueWatchingCardSkeleton';
import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';

import {
  type HomeClientSnapshot,
  getHomeClientSnapshot,
} from '../lib/home-client-cache';
import HomeClient from './HomeClient';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function CapsuleSwitchSkeleton() {
  return (
    <div className='relative flex items-end'>
      <div className='absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-gray-300/60 to-transparent dark:via-white/20' />

      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className='relative px-6 py-3'>
          <div className='flex items-center gap-2'>
            <div className='h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            <div className='h-5 w-10 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          </div>
        </div>
      ))}
    </div>
  );
}

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
    <PageLayout>
      <div className='overflow-visible px-2 pb-2 pt-4 sm:px-10 sm:pt-8'>
        <div className='mb-4 hidden justify-center md:flex'>
          <CapsuleSwitchSkeleton />
        </div>

        <div className='mx-auto max-w-[95%]'>
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
  const [snapshot, setSnapshot] = useState<HomeClientSnapshot | null>(null);

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
