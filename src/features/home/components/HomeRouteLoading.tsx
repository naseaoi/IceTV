'use client';

import { useEffect, useLayoutEffect, useState } from 'react';

import ContinueWatchingCardSkeleton from '@/components/ContinueWatchingCardSkeleton';
import HomePosterCardSkeleton, {
  HOME_RECOMMENDATION_INITIAL_COUNT,
} from '@/components/HomePosterCardSkeleton';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import {
  SECTION_HEADER_CLASS,
  SECTION_LINK_TEXT_CLASS,
  SECTION_TITLE_TEXT_CLASS,
} from '@/components/section-header';
import SkeletonText from '@/components/SkeletonText';
import { useClientHydrated } from '@/hooks/useClientHydrated';

import {
  type HomeClientSnapshot,
  getHomeClientSnapshot,
} from '../lib/home-client-cache';
import {
  HOME_BODY_CLASS,
  HOME_SECTION_CLASS,
  HOME_SECTIONS_CLASS,
} from '../lib/home-layout';
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
    <div className={SECTION_HEADER_CLASS}>
      <SkeletonText
        className={SECTION_TITLE_TEXT_CLASS}
        barClassName='h-6 w-28 rounded'
      />
      <SkeletonText
        className={SECTION_LINK_TEXT_CLASS}
        barClassName='h-4 w-16 rounded'
      />
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
      <div className={HOME_BODY_CLASS}>
        <div className={PAGE_CONTAINER_CLASS}>
          <div className={HOME_SECTIONS_CLASS}>
            {continueWatchingCount > 0 && (
              <section className={HOME_SECTION_CLASS}>
                <SkeletonSectionHeader />
                <SkeletonRow count={continueWatchingCount} mobileContinue />
              </section>
            )}

            <section className={HOME_SECTION_CLASS}>
              <SkeletonSectionHeader />
              <SkeletonRow count={HOME_RECOMMENDATION_INITIAL_COUNT} />
            </section>

            <section className={HOME_SECTION_CLASS}>
              <SkeletonSectionHeader />
              <SkeletonRow count={HOME_RECOMMENDATION_INITIAL_COUNT} />
            </section>

            <section className={HOME_SECTION_CLASS}>
              <SkeletonSectionHeader />
              <SkeletonRow count={HOME_RECOMMENDATION_INITIAL_COUNT} />
            </section>

            <section className={HOME_SECTION_CLASS}>
              <SkeletonSectionHeader />
              <SkeletonRow count={HOME_RECOMMENDATION_INITIAL_COUNT} />
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
