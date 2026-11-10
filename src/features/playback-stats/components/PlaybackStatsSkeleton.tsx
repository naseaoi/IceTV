'use client';

import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import ScrollableRow from '@/components/ScrollableRow';
import { getCachedPlaybackPeriodSnapshot } from '@/features/playback-stats/lib/client';
import { PLAYBACK_TOP_WORKS_LIMIT } from '@/features/playback-stats/types';

// 桌面端观看统计与常看并排，统计卡拉伸到与海报区同高
export const STATS_LAYOUT_CLASS =
  'space-y-4 sm:space-y-6 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-x-8 md:space-y-0';

export const STATS_COLUMN_CLASS = 'flex min-w-0 flex-col';

// 上下外边距对齐 ScrollableRow 的内边距，卡片边缘与海报顶部、标题底部齐平
export const STATS_CARD_CLASS =
  'mt-2 flex flex-col rounded-2xl bg-white p-4 ring-1 ring-gray-200/80 dark:bg-white/[0.03] dark:ring-white/10 sm:p-5 md:mb-6 md:flex-1';

// 周柱状图：每天一条满宽底槽，时长从底部按比例填充；骨架与真实组件共用
export const WEEK_CHART_CLASS =
  'mt-5 grid min-h-0 flex-1 grid-cols-7 gap-2 sm:gap-2.5';
export const WEEK_DAY_CLASS = 'flex min-w-0 flex-col items-stretch gap-2';
export const WEEK_TRACK_CLASS =
  'relative flex h-20 w-full items-end overflow-hidden rounded-lg md:h-auto md:min-h-20 md:flex-1';
export const WEEK_LABEL_CLASS = 'flex h-4 items-center justify-center text-xs';

// 时段条：24 格热度 + 刻度行，骨架与真实组件共用
export const HOUR_STRIP_CLASS = 'mt-4 shrink-0';
export const HOUR_STRIP_CELLS_CLASS = 'flex h-3 gap-[2px]';
export const HOUR_STRIP_AXIS_CLASS =
  'relative mt-1.5 h-[15px] text-[10px] leading-[15px] tabular-nums';

export function StatsHeading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className='mb-1 flex h-7 items-center justify-between gap-3 sm:mb-2'>
      <h2 className='text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100'>
        {title}
      </h2>
      {children}
    </div>
  );
}

const BLOCK_CLASS = 'skeleton rounded';

function MetricSkeleton() {
  return (
    <div>
      <div className='flex h-[1.5em] items-center text-[13px]'>
        <div className={`h-3 w-10 ${BLOCK_CLASS}`} />
      </div>
      <div className='relative mt-1 flex items-baseline gap-0.5'>
        <span
          aria-hidden='true'
          className='invisible flex items-baseline gap-0.5'
        >
          <span className='text-[28px] font-semibold leading-none'>0</span>
          <span className='text-[13px]'>分钟</span>
        </span>
        <div className={`absolute inset-y-0 w-24 ${BLOCK_CLASS}`} />
      </div>
    </div>
  );
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function PlaybackStatsSkeleton() {
  const [count, setCount] = useState(PLAYBACK_TOP_WORKS_LIMIT);
  useIsomorphicLayoutEffect(() => {
    const cached = getCachedPlaybackPeriodSnapshot('week');
    if (cached) setCount(cached.topWorks.length);
  }, []);
  return (
    <div className={STATS_LAYOUT_CLASS}>
      <section className={STATS_COLUMN_CLASS}>
        <StatsHeading title='观看统计' />
        <div className={STATS_CARD_CLASS}>
          <div className='flex flex-wrap gap-x-8 gap-y-3'>
            <MetricSkeleton />
            <MetricSkeleton />
          </div>
          <div className={WEEK_CHART_CLASS}>
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className={WEEK_DAY_CLASS}>
                <div className={`${WEEK_TRACK_CLASS} skeleton`} />
                <div className={WEEK_LABEL_CLASS}>
                  <div className={`h-3 w-4 ${BLOCK_CLASS}`} />
                </div>
              </div>
            ))}
          </div>
          <div className={HOUR_STRIP_CLASS}>
            <div className={`${HOUR_STRIP_CELLS_CLASS} ${BLOCK_CLASS}`} />
            <div className={HOUR_STRIP_AXIS_CLASS} />
          </div>
        </div>
      </section>
      <section className={STATS_COLUMN_CLASS}>
        <StatsHeading title='常看'>
          <div className='skeleton h-7 w-28 rounded-full' />
        </StatsHeading>
        <div className={count === 0 ? 'invisible' : undefined}>
          <ScrollableRow>
            {Array.from({ length: Math.max(1, count) }, (_, index) => (
              <HomePosterCardSkeleton key={index} subtitle />
            ))}
          </ScrollableRow>
        </div>
      </section>
    </div>
  );
}
