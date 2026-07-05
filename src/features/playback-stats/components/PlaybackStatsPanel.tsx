'use client';

import { BarChart3, Clock3, History, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  getCachedPlaybackStatsSummarySnapshot,
  getPlaybackStatsSummary,
} from '@/features/playback-stats/lib/client';
import type { PlaybackStatsSummary } from '@/features/playback-stats/types';

const RECENT_ITEM_LIMIT = 4;
const TOP_ITEM_LIMIT = 4;
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
    <div className='rounded-lg border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/50'>
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

function PlaybackStatsSkeleton() {
  return (
    <section className='mb-4'>
      <div className='mb-4 h-7 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='h-28 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-900' />
        <div className='h-28 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-900' />
      </div>
      <div className='mt-3 h-40 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-900' />
      <div className='mt-3 grid gap-3 lg:grid-cols-2'>
        <div className='h-36 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-900' />
        <div className='h-36 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-900' />
      </div>
    </section>
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
    <section className='mb-4'>
      <h2 className='mb-4 flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-200'>
        <BarChart3 className='h-5 w-5 text-green-500' />
        观看统计
      </h2>

      <div className='grid gap-3 sm:grid-cols-2'>
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

      <div className='mt-3 rounded-lg border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/50'>
        <div className='mb-4 flex items-center justify-between gap-3 text-sm'>
          <div className='flex items-center gap-2 font-medium text-gray-700 dark:text-gray-200'>
            <BarChart3 className='h-4 w-4 text-blue-500' />
            最近一周
          </div>
          {activeDailyItem && (
            <div className='shrink-0 text-xs text-gray-500 dark:text-gray-400'>
              {formatShortDate(activeDailyItem.date)} ·{' '}
              {formatDuration(activeDailyItem.watchSeconds)}
            </div>
          )}
        </div>
        <div className='grid grid-cols-7 items-end gap-2'>
          {displaySummary.dailyWatchSeconds.map((item) => {
            const height = Math.max(
              8,
              Math.round((item.watchSeconds / maxDailySeconds) * 96),
            );
            const isActive = activeDailyItem?.date === item.date;
            return (
              <div
                key={item.date}
                className='flex min-w-0 flex-col items-center'
              >
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
                <div className='mt-2 truncate text-xs text-gray-500 dark:text-gray-400'>
                  {formatShortDate(item.date)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className='mt-3 grid gap-3 lg:grid-cols-2'>
        <div className='rounded-lg border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/50'>
          <div className='mb-3 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200'>
            <History className='h-4 w-4 text-orange-500' />
            最近观看
          </div>
          {displaySummary.recentItems.length > 0 ? (
            <div className='space-y-2'>
              {displaySummary.recentItems
                .slice(0, RECENT_ITEM_LIMIT)
                .map((item) => (
                  <div
                    key={item.id}
                    className='flex min-w-0 items-center justify-between gap-3 text-sm'
                  >
                    <div className='min-w-0 truncate text-gray-800 dark:text-gray-100'>
                      {item.title}
                    </div>
                    <div className='shrink-0 text-gray-500 dark:text-gray-400'>
                      {formatDuration(item.watch_seconds)}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className='flex min-h-[88px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400'>
              暂无最近观看
            </div>
          )}
        </div>

        <div className='rounded-lg border border-gray-200 bg-white/70 p-4 dark:border-gray-700 dark:bg-gray-900/50'>
          <div className='mb-3 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200'>
            <TrendingUp className='h-4 w-4 text-pink-500' />
            常看内容
          </div>
          {displaySummary.topItems.length > 0 ? (
            <div className='space-y-2'>
              {displaySummary.topItems.slice(0, TOP_ITEM_LIMIT).map((item) => (
                <div
                  key={`${item.source}+${item.videoId}`}
                  className='flex min-w-0 items-center justify-between gap-3 text-sm'
                >
                  <div className='min-w-0 truncate text-gray-800 dark:text-gray-100'>
                    {item.title}
                  </div>
                  <div className='shrink-0 text-gray-500 dark:text-gray-400'>
                    {formatDuration(item.watchSeconds)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className='flex min-h-[88px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400'>
              暂无常看内容
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
