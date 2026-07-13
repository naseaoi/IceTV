'use client';

import { BarChart3, Clock3, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { PlaybackStatsSkeleton } from '@/features/playback-stats/components/PlaybackStatsSkeleton';
import {
  getCachedPlaybackStatsSummarySnapshot,
  getPlaybackStatsSummary,
  getPlaybackTopItems,
} from '@/features/playback-stats/lib/client';
import type {
  PlaybackStatsSummary,
  PlaybackTopRange,
} from '@/features/playback-stats/types';

const TOP_ITEM_LIMIT = 3;
const TOP_RANGE_OPTIONS: Array<{ value: PlaybackTopRange; label: string }> = [
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'all', label: '总' },
];
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  }
  return `${minutes}分钟`;
}

function formatShortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function formatLocalDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createEmptySummary(now = Date.now()): PlaybackStatsSummary {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const todayStart = date.getTime();

  return {
    totalWatchSeconds: 0,
    weekWatchSeconds: 0,
    dailyWatchSeconds: Array.from({ length: 7 }, (_, index) => ({
      date: formatLocalDate(todayStart - (6 - index) * DAY_MS),
      watchSeconds: 0,
    })),
    recentItems: [],
    topItems: [],
  };
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <div className='h-full rounded-lg border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/50'>
      <div className='mb-3 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
        <Icon className='h-4 w-4 text-green-500' />
        {label}
      </div>
      <div className='truncate text-2xl font-semibold text-gray-900 dark:text-gray-100'>
        {value}
      </div>
    </div>
  );
}

function TopContentTile({
  items,
}: {
  items: PlaybackStatsSummary['topItems'];
}) {
  const [activeRange, setActiveRange] = useState<PlaybackTopRange>('week');
  const [loadingRange, setLoadingRange] = useState<PlaybackTopRange | null>(
    null,
  );
  const [loadedRanges, setLoadedRanges] = useState<
    Record<PlaybackTopRange, boolean>
  >({
    week: true,
    month: false,
    all: false,
  });
  const [itemsByRange, setItemsByRange] = useState<
    Record<PlaybackTopRange, PlaybackStatsSummary['topItems']>
  >({
    week: items,
    month: [],
    all: [],
  });

  useEffect(() => {
    setItemsByRange((prev) => ({ ...prev, week: items }));
    setLoadedRanges((prev) => ({ ...prev, week: true }));
  }, [items]);

  useEffect(() => {
    if (activeRange === 'week' || loadedRanges[activeRange]) return;

    let cancelled = false;
    setLoadingRange(activeRange);
    getPlaybackTopItems(activeRange)
      .then((response) => {
        if (cancelled) return;
        setItemsByRange((prev) => ({
          ...prev,
          [response.range]: response.items,
        }));
        setLoadedRanges((prev) => ({
          ...prev,
          [response.range]: true,
        }));
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('获取常看内容失败:', error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingRange(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRange, loadedRanges]);

  const activeItems = itemsByRange[activeRange];
  const isLoading = loadingRange === activeRange;

  return (
    <div className='flex h-36 min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/50'>
      <div className='mb-3 flex min-w-0 items-center justify-between gap-2 text-sm text-gray-500 dark:text-gray-400'>
        <div className='flex min-w-0 items-center gap-2'>
          <TrendingUp className='h-4 w-4 shrink-0 text-pink-500' />
          <span className='truncate'>常看内容</span>
        </div>
        <div className='flex h-6 shrink-0 rounded border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800'>
          {TOP_RANGE_OPTIONS.map((option) => {
            const selected = activeRange === option.value;
            return (
              <button
                key={option.value}
                type='button'
                className={`min-w-7 rounded px-2 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-green-500/30 ${
                  selected
                    ? 'bg-green-600 text-white'
                    : 'text-gray-500 hover:bg-white hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100'
                }`}
                aria-pressed={selected}
                onClick={() => setActiveRange(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      {activeItems.length > 0 ? (
        <div className={`min-w-0 space-y-2 ${isLoading ? 'opacity-50' : ''}`}>
          {activeItems.slice(0, TOP_ITEM_LIMIT).map((item) => (
            <div
              key={`${item.source}+${item.videoId}`}
              className='flex min-w-0 items-center justify-between gap-3 text-sm'
            >
              <div
                className='min-w-0 flex-1 truncate text-gray-800 dark:text-gray-100'
                title={item.title}
              >
                {item.title}
              </div>
              <div className='shrink-0 text-gray-500 dark:text-gray-400'>
                {formatDuration(item.watchSeconds)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className='flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400'>
          {isLoading ? '加载中...' : '暂无常看内容'}
        </div>
      )}
    </div>
  );
}

export function PlaybackStatsPanel() {
  const [summary, setSummary] = useState<PlaybackStatsSummary | null>(() =>
    getCachedPlaybackStatsSummarySnapshot(),
  );
  const [loading, setLoading] = useState(
    () => !getCachedPlaybackStatsSummarySnapshot(),
  );
  const [activeDailyDate, setActiveDailyDate] = useState<string | null>(null);
  const emptySummary = useMemo(() => createEmptySummary(), []);
  const displaySummary = summary || emptySummary;

  useEffect(() => {
    let cancelled = false;

    const loadSummary = async () => {
      try {
        if (!getCachedPlaybackStatsSummarySnapshot()) {
          setLoading(true);
        }
        const data = await getPlaybackStatsSummary();
        if (!cancelled) {
          setSummary(data);
        }
      } catch (error) {
        console.error('获取播放统计失败:', error);
        if (!cancelled && !getCachedPlaybackStatsSummarySnapshot()) {
          setSummary(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, []);

  const maxDailySeconds = useMemo(() => {
    return Math.max(
      1,
      ...displaySummary.dailyWatchSeconds.map((item) => item.watchSeconds),
    );
  }, [displaySummary]);

  const activeDailyItem = useMemo(() => {
    return (
      displaySummary.dailyWatchSeconds.find(
        (item) => item.date === activeDailyDate,
      ) ||
      displaySummary.dailyWatchSeconds[
        displaySummary.dailyWatchSeconds.length - 1
      ] ||
      null
    );
  }, [activeDailyDate, displaySummary]);

  if (loading) {
    return <PlaybackStatsSkeleton />;
  }

  return (
    <section className='mb-2'>
      <h2 className='mb-4 flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-200'>
        <BarChart3 className='h-5 w-5 text-green-500' />
        观看统计
      </h2>

      <div className='grid min-w-0 gap-3 sm:grid-cols-2'>
        <StatTile
          icon={Clock3}
          label='本周观看'
          value={formatDuration(displaySummary.weekWatchSeconds)}
        />
        <StatTile
          icon={TrendingUp}
          label='累计观看'
          value={formatDuration(displaySummary.totalWatchSeconds)}
        />
      </div>

      <div className='mt-3 grid min-w-0 items-stretch gap-3 md:grid-cols-2'>
        <div className='h-36 rounded-lg border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/50'>
          <div className='mb-3 flex items-center justify-between gap-3 text-sm'>
            <div className='flex items-center gap-2 font-medium text-gray-700 dark:text-gray-200'>
              <BarChart3 className='h-4 w-4 text-blue-500' />
              最近一周
            </div>
            {activeDailyItem && (
              <div className='shrink-0 text-xs text-green-600 dark:text-green-400'>
                {formatShortDate(activeDailyItem.date)} ·{' '}
                {formatDuration(activeDailyItem.watchSeconds)}
              </div>
            )}
          </div>
          <div className='grid h-20 grid-cols-7 gap-2'>
            {displaySummary.dailyWatchSeconds.map((item) => {
              const height = Math.max(
                8,
                Math.round((item.watchSeconds / maxDailySeconds) * 56),
              );
              const isActive = activeDailyItem?.date === item.date;
              return (
                <div
                  key={item.date}
                  className='grid h-full min-w-0 grid-rows-[1fr_auto] items-end'
                >
                  <div className='flex h-14 items-end'>
                    <button
                      type='button'
                      className={`w-full rounded-t transition-colors focus:outline-none focus:ring-2 focus:ring-green-500/40 ${
                        isActive
                          ? 'bg-green-600'
                          : 'bg-green-500/80 hover:bg-green-500'
                      }`}
                      style={{ height }}
                      title={formatDuration(item.watchSeconds)}
                      aria-label={`${formatShortDate(item.date)} ${formatDuration(
                        item.watchSeconds,
                      )}`}
                      onClick={() => setActiveDailyDate(item.date)}
                      onFocus={() => setActiveDailyDate(item.date)}
                      onMouseEnter={() => setActiveDailyDate(item.date)}
                    />
                  </div>
                  <div className='mt-2 truncate text-center text-xs text-gray-500 dark:text-gray-400'>
                    {formatShortDate(item.date)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <TopContentTile items={displaySummary.topItems} />
      </div>
    </section>
  );
}
