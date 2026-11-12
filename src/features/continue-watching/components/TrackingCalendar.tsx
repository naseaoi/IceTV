'use client';

import { CalendarDays, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { buildContinuePlayUrl } from '@/components/continue-card/play-url';
import CoverImage from '@/components/CoverImage';
import {
  LIBRARY_PILL_BUTTON_CLASS,
  LibraryEmptyState,
} from '@/components/LibraryPage';
import LoadErrorState from '@/components/LoadErrorState';
import SkeletonText from '@/components/SkeletonText';
import {
  type PlacedCalendarItem,
  type TrackingCalendarItem,
  type Weekday,
  formatCalendarProgress,
  getWeekDates,
  groupTrackingCalendar,
  toWeekday,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from '@/features/continue-watching/lib/tracking-calendar';
import { fetchTrackingCalendar } from '@/features/continue-watching/lib/tracking-calendar-client';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

// 条目与骨架共用几何类，改动时两侧同步
const ENTRY_CLASS = 'flex items-center gap-3 rounded-xl p-1.5';
const ENTRY_COVER_CLASS =
  'relative aspect-[2/3] w-11 shrink-0 overflow-hidden rounded-lg';
const ENTRY_TITLE_CLASS = 'text-[13px] leading-[18px]';
const ENTRY_META_CLASS = 'mt-1 text-xs leading-4';
const DAY_LIST_CLASS =
  'mt-4 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3';
const DAY_STRIP_CLASS = 'grid grid-cols-7 gap-1 rounded-2xl p-1';
const DAY_STRIP_HEIGHT_CLASS = 'h-[60px]';
const WEEK_GRID_CLASS = 'grid grid-cols-7 gap-2';
const DAY_COLUMN_CLASS = 'min-h-[13rem] min-w-0 rounded-2xl p-1.5';
const DAY_HEADER_CLASS = 'flex h-9 items-center justify-between px-2';

const SHORT_LABELS: Record<Weekday, string> = {
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
  7: '日',
};

function CalendarEntry({
  item,
}: {
  item: TrackingCalendarItem | PlacedCalendarItem;
}) {
  const inferred = 'inferred' in item && item.inferred;
  return (
    <Link
      href={buildContinuePlayUrl({
        source: item.source,
        id: item.id,
        title: item.title,
        year: item.year,
        query: item.searchTitle,
      })}
      title={inferred ? '按最近一次更新推测' : undefined}
      className={`${ENTRY_CLASS} group transition-colors hover:bg-gray-900/[0.04] dark:hover:bg-white/[0.06]`}
    >
      <div className={`${ENTRY_COVER_CLASS} bg-gray-200 dark:bg-gray-800`}>
        <CoverImage
          src={item.cover}
          alt={item.title}
          sizes='48px'
          fallbackLabel=''
        />
      </div>
      <div className='min-w-0 flex-1'>
        <p
          className={`${ENTRY_TITLE_CLASS} line-clamp-2 font-medium text-gray-900 transition-colors group-hover:text-brand-600 dark:text-gray-100 dark:group-hover:text-brand-400`}
        >
          {item.title}
        </p>
        <p
          className={`${ENTRY_META_CLASS} flex min-w-0 items-center gap-1 text-gray-500 dark:text-gray-400`}
        >
          {item.hasUpdate && (
            <>
              <span className='shrink-0 font-medium text-amber-600 dark:text-amber-400'>
                有更新
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

function CalendarEntrySkeleton() {
  return (
    <div className={ENTRY_CLASS}>
      <div className={`${ENTRY_COVER_CLASS} skeleton`} />
      <div className='min-w-0 flex-1'>
        <SkeletonText
          className={ENTRY_TITLE_CLASS}
          barClassName='h-3 w-4/5 rounded'
        />
        <SkeletonText
          className={ENTRY_META_CLASS}
          barClassName='h-2.5 w-14 rounded'
        />
      </div>
    </div>
  );
}

function DayStrip({
  groups,
  dates,
  today,
  selected,
  onSelect,
}: {
  groups: Record<Weekday, PlacedCalendarItem[]>;
  dates: Record<Weekday, Date>;
  today: Weekday;
  selected: Weekday;
  onSelect: (weekday: Weekday) => void;
}) {
  return (
    <div
      role='group'
      aria-label='星期'
      className={`${DAY_STRIP_CLASS} bg-white/75 ring-1 ring-inset ring-black/[0.06] dark:bg-white/[0.04] dark:ring-white/[0.06]`}
    >
      {WEEKDAYS.map((weekday) => {
        const items = groups[weekday];
        const active = weekday === selected;
        const hasUpdate = items.some((item) => item.hasUpdate);
        return (
          <button
            key={weekday}
            type='button'
            aria-pressed={active}
            aria-label={`${WEEKDAY_LABELS[weekday]}${weekday === today ? '（今天）' : ''}，${items.length} 部`}
            onClick={() => onSelect(weekday)}
            className={`flex ${DAY_STRIP_HEIGHT_CLASS} flex-col items-center justify-center rounded-xl text-xs transition ${
              active
                ? 'bg-gray-900 text-white shadow-sm dark:bg-white dark:text-gray-900'
                : weekday === today
                  ? 'font-semibold text-brand-600 dark:text-brand-400'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            }`}
          >
            <span>{weekday === today ? '今' : SHORT_LABELS[weekday]}</span>
            <span className='mt-0.5 text-sm font-medium tabular-nums'>
              {dates[weekday].getDate()}
            </span>
            <span
              aria-hidden='true'
              className={`mt-1 h-1 w-1 rounded-full ${
                items.length === 0
                  ? 'bg-transparent'
                  : hasUpdate
                    ? 'bg-amber-500'
                    : 'bg-current opacity-40'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

function DayColumn({
  weekday,
  date,
  today,
  items,
}: {
  weekday: Weekday;
  date: Date;
  today: boolean;
  items: PlacedCalendarItem[];
}) {
  return (
    <section
      aria-label={WEEKDAY_LABELS[weekday]}
      className={`${DAY_COLUMN_CLASS} ring-1 ring-inset ${
        today
          ? 'bg-brand-500/[0.07] ring-brand-500/25'
          : 'bg-white/60 ring-black/[0.05] dark:bg-white/[0.03] dark:ring-white/[0.05]'
      }`}
    >
      <header className={DAY_HEADER_CLASS}>
        <h3
          className={`text-sm font-semibold ${
            today
              ? 'text-brand-600 dark:text-brand-400'
              : 'text-gray-900 dark:text-gray-100'
          }`}
        >
          {WEEKDAY_LABELS[weekday]}
        </h3>
        <span
          className={`text-xs tabular-nums ${
            today
              ? 'font-medium text-brand-600 dark:text-brand-400'
              : 'text-gray-400 dark:text-gray-500'
          }`}
        >
          {today ? '今天' : `${date.getMonth() + 1}/${date.getDate()}`}
        </span>
      </header>
      <div className='space-y-0.5'>
        {items.map((item) => (
          <CalendarEntry key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
}

function UnscheduledSection({
  items,
  defaultOpen,
}: {
  items: TrackingCalendarItem[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className='mt-8'>
      <button
        type='button'
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className='flex items-center gap-1.5 rounded-full py-1 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
      >
        近期无更新
        <span className='tabular-nums opacity-60'>{items.length}</span>
        <ChevronDown
          aria-hidden='true'
          className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className='mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {items.map((item) => (
            <CalendarEntry key={item.key} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

export function TrackingCalendarSkeleton() {
  return (
    <div aria-hidden='true'>
      <div className='xl:hidden'>
        <div
          className={`skeleton ${DAY_STRIP_CLASS} ${DAY_STRIP_HEIGHT_CLASS} box-content`}
        />
        <div className={DAY_LIST_CLASS}>
          {Array.from({ length: 3 }, (_, index) => (
            <CalendarEntrySkeleton key={index} />
          ))}
        </div>
      </div>
      <div className={`hidden xl:grid ${WEEK_GRID_CLASS}`}>
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className={`${DAY_COLUMN_CLASS} bg-white/60 ring-1 ring-inset ring-black/[0.05] dark:bg-white/[0.03] dark:ring-white/[0.05]`}
          >
            <div className={DAY_HEADER_CLASS}>
              <div className='skeleton h-3.5 w-8 rounded' />
            </div>
            <CalendarEntrySkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrackingCalendar() {
  const [items, setItems] = useState<TrackingCalendarItem[] | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [now] = useState(() => Date.now());
  const today = toWeekday(new Date(now));
  const [selected, setSelected] = useState<Weekday>(today);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetchTrackingCalendar(controller.signal)
      .then(setItems)
      .catch((fetchError) => {
        if (!isAbortError(fetchError)) {
          setError(getErrorMessage(fetchError, '周历加载失败'));
        }
      });
    return () => controller.abort();
  }, [reloadKey]);

  const groups = useMemo(
    () => (items ? groupTrackingCalendar(items, now) : null),
    [items, now],
  );
  const dates = useMemo(() => getWeekDates(new Date(now)), [now]);

  if (error && !items) {
    return (
      <LoadErrorState
        message={error}
        onRetry={() => setReloadKey((value) => value + 1)}
      />
    );
  }
  if (!groups || !items) return <TrackingCalendarSkeleton />;
  if (items.length === 0) {
    return (
      <LibraryEmptyState
        icon={CalendarDays}
        title='还没有在追的剧'
        action={
          <Link href='/' className={LIBRARY_PILL_BUTTON_CLASS}>
            去首页逛逛
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <div className='xl:hidden'>
        <DayStrip
          groups={groups.days}
          dates={dates}
          today={today}
          selected={selected}
          onSelect={setSelected}
        />
        {groups.days[selected].length > 0 ? (
          <div className={DAY_LIST_CLASS}>
            {groups.days[selected].map((item) => (
              <CalendarEntry key={item.key} item={item} />
            ))}
          </div>
        ) : (
          <p className='py-12 text-center text-sm text-gray-500 dark:text-gray-400'>
            这天没有要追的更新
          </p>
        )}
      </div>
      <div className={`hidden xl:grid ${WEEK_GRID_CLASS}`}>
        {WEEKDAYS.map((weekday) => (
          <DayColumn
            key={weekday}
            weekday={weekday}
            date={dates[weekday]}
            today={weekday === today}
            items={groups.days[weekday]}
          />
        ))}
      </div>
      {groups.unscheduled.length > 0 && (
        <UnscheduledSection
          items={groups.unscheduled}
          defaultOpen={WEEKDAYS.every(
            (weekday) => groups.days[weekday].length === 0,
          )}
        />
      )}
    </div>
  );
}
