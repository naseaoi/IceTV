'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSyncExternalStore } from 'react';

import { useMediaCardMenu } from '@/components/card-actions/useMediaCardMenu';
import { buildContinuePlayUrl } from '@/components/continue-card/play-url';
import CoverImage from '@/components/CoverImage';
import SkeletonText from '@/components/SkeletonText';
import { parseContinueWatchingFilter } from '@/features/continue-watching/lib/layout';
import {
  type TrackingCalendarItem,
  type TrackingStripStatus,
  type Weekday,
  formatCalendarProgress,
  getTrackingStripStatus,
  toWeekday,
} from '@/features/continue-watching/lib/tracking-calendar';

// 真实条目与骨架共用几何类，改动时两侧同步
const SECTION_CLASS = 'mb-6 sm:mb-8';
const HEADING_CLASS = 'mb-2 text-sm font-medium leading-5';
// 横向滚动贴到屏幕边缘，左右留白与页面容器一致；吸附边距同步留白，否则首张卡片被吸到屏幕边缘
const ROW_CLASS =
  '-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-8 sm:scroll-px-8 sm:px-8 xl:-mx-12 xl:scroll-px-12 xl:px-12 [&::-webkit-scrollbar]:hidden';
const ENTRY_CLASS =
  'flex w-64 shrink-0 snap-start items-center gap-3 rounded-xl p-2 ring-1 ring-inset';
const ENTRY_SURFACE_CLASS =
  'bg-white/70 ring-black/[0.05] dark:bg-white/[0.04] dark:ring-white/[0.06]';
const COVER_CLASS =
  'relative aspect-[2/3] w-10 shrink-0 overflow-hidden rounded-md';
const TITLE_CLASS = 'text-sm leading-5';
const META_CLASS = 'mt-1 text-xs leading-4';

const STATUS_TONE_CLASS: Record<TrackingStripStatus['tone'], string> = {
  update: 'text-amber-600 dark:text-amber-400',
  today: 'text-brand-600 dark:text-brand-400',
  scheduled: 'text-gray-700 dark:text-gray-300',
};

// 跨过本地午夜或页面从后台恢复时重新取「今天」
function subscribeToday(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    timer = setTimeout(() => {
      onChange();
      schedule();
    }, midnight.getTime() - Date.now());
  };
  const handleVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    onChange();
    schedule();
  };
  schedule();
  document.addEventListener('visibilitychange', handleVisibility);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}
const getClientToday = () => toWeekday(new Date());
const getServerToday = () => null;

// 「今天 / 明天」取浏览器本地时区，服务端与水合期间只显示星期
function useLocalToday(): Weekday | null {
  return useSyncExternalStore(subscribeToday, getClientToday, getServerToday);
}

function TrackingStripEntry({
  item,
  today,
}: {
  item: TrackingCalendarItem;
  today: Weekday | null;
}) {
  const href = buildContinuePlayUrl({
    source: item.source,
    id: item.id,
    title: item.title,
    year: item.year,
    query: item.searchTitle,
  });
  const menuProps = useMediaCardMenu({
    target: {
      source: item.source,
      id: item.id,
      title: item.title,
      year: item.year,
      cover: item.cover,
      searchTitle: item.searchTitle,
      totalEpisodes: item.totalEpisodes ?? undefined,
    },
    href,
  });
  const status = getTrackingStripStatus(item, today);
  return (
    <Link
      href={href}
      {...menuProps}
      className={`${ENTRY_CLASS} ${ENTRY_SURFACE_CLASS} group transition-colors hover:bg-white dark:hover:bg-white/[0.08]`}
    >
      <div className={`${COVER_CLASS} bg-gray-200 dark:bg-gray-800`}>
        <CoverImage
          src={item.cover}
          alt={item.title}
          sizes='40px'
          fallbackLabel=''
        />
      </div>
      <div className='min-w-0 flex-1'>
        <p
          className={`${TITLE_CLASS} truncate font-medium text-gray-900 transition-colors group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-400`}
        >
          {item.title}
        </p>
        <p
          className={`${META_CLASS} flex min-w-0 items-center gap-1 text-gray-500 dark:text-gray-400`}
        >
          {status && (
            <>
              <span
                className={`shrink-0 font-medium ${STATUS_TONE_CLASS[status.tone]}`}
              >
                {status.label}
              </span>
              <span aria-hidden='true'>·</span>
            </>
          )}
          <span className='truncate tabular-nums'>
            {formatCalendarProgress(item)}
          </span>
        </p>
      </div>
    </Link>
  );
}

function TrackingStripHeading() {
  return (
    <h2 className={`${HEADING_CLASS} text-gray-500 dark:text-gray-400`}>
      追更
    </h2>
  );
}

export function TrackingStrip({ items }: { items: TrackingCalendarItem[] }) {
  const today = useLocalToday();
  if (items.length === 0) return null;
  return (
    <section aria-label='追更' className={SECTION_CLASS}>
      <TrackingStripHeading />
      <div className={ROW_CLASS}>
        {items.map((item) => (
          <TrackingStripEntry key={item.key} item={item} today={today} />
        ))}
      </div>
    </section>
  );
}

// 条数取计数 cookie；为 0 或不在「全部」筛选时与真实区块一样不占位
export function TrackingStripSkeleton({ count }: { count: number }) {
  const filter = parseContinueWatchingFilter(useSearchParams()?.get('filter'));
  if (count === 0 || filter !== 'all') return null;
  return (
    <div aria-hidden='true' className={SECTION_CLASS}>
      <SkeletonText
        className={HEADING_CLASS}
        barClassName='h-3.5 w-8 rounded'
      />
      <div className={ROW_CLASS}>
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className={`${ENTRY_CLASS} ${ENTRY_SURFACE_CLASS}`}>
            <div className={`skeleton ${COVER_CLASS}`} />
            <div className='min-w-0 flex-1'>
              <SkeletonText className={TITLE_CLASS} />
              <SkeletonText
                className={META_CLASS}
                barClassName='h-3 w-1/2 rounded'
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
