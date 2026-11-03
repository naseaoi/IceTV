import type { ReactNode } from 'react';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import ScrollableRow from '@/components/ScrollableRow';

// 桌面端观看统计与常看并排，统计卡拉伸到与海报区同高
export const STATS_LAYOUT_CLASS =
  'space-y-4 sm:space-y-6 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-x-8 md:space-y-0';

export const STATS_COLUMN_CLASS = 'flex min-w-0 flex-col';

// 上下外边距对齐 ScrollableRow 的内边距，卡片边缘与海报顶部、标题底部齐平
export const STATS_CARD_CLASS =
  'mt-2 flex flex-col rounded-2xl bg-white p-4 ring-1 ring-gray-200/80 dark:bg-white/[0.03] dark:ring-white/10 sm:p-5 md:mb-6 md:flex-1';

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

export function PlaybackStatsSkeleton() {
  return (
    <div className={STATS_LAYOUT_CLASS}>
      <section className={STATS_COLUMN_CLASS}>
        <StatsHeading title='观看统计' />
        <div className={STATS_CARD_CLASS}>
          <div className='flex flex-wrap gap-x-8 gap-y-3'>
            <MetricSkeleton />
            <MetricSkeleton />
          </div>
          <div className='mt-5 grid flex-1 grid-cols-7 gap-1.5'>
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className='flex flex-col items-center gap-2'>
                <div className='flex h-20 w-full items-end justify-center md:h-auto md:min-h-20 md:flex-1'>
                  <div
                    className={`w-full max-w-[28px] rounded-md ${BLOCK_CLASS}`}
                    style={{ height: 12 + ((index * 11) % 44) }}
                  />
                </div>
                <div className='flex h-4 items-center'>
                  <div className={`h-3 w-4 ${BLOCK_CLASS}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className={STATS_COLUMN_CLASS}>
        <StatsHeading title='常看'>
          <div className='skeleton h-7 w-28 rounded-full' />
        </StatsHeading>
        <ScrollableRow>
          {Array.from({ length: 4 }, (_, index) => (
            <HomePosterCardSkeleton key={index} subtitle />
          ))}
        </ScrollableRow>
      </section>
    </div>
  );
}
