'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react';

import {
  HOME_POSTER_CARD_CLASS,
  POSTER_CARD_COVER_CLASS,
  POSTER_CARD_SUBTITLE_ROW_CLASS,
  POSTER_CARD_TITLE_ROW_CLASS,
} from '@/components/poster-card-layout';
import ScrollableRow from '@/components/ScrollableRow';
import { PlaybackPosterCard } from '@/features/playback-stats/components/PlaybackPosterCard';
import {
  PlaybackStatsSkeleton,
  STATS_CARD_CLASS,
  STATS_COLUMN_CLASS,
  STATS_LAYOUT_CLASS,
  StatsHeading,
} from '@/features/playback-stats/components/PlaybackStatsSkeleton';
import {
  getCachedPlaybackPeriodSnapshot,
  getPlaybackPeriodStats,
} from '@/features/playback-stats/lib/client';
import type {
  PlaybackPeriodBucket,
  PlaybackPeriodStats,
  PlaybackPeriodType,
  PlaybackTopWork,
} from '@/features/playback-stats/types';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const TOP_RANGE_OPTIONS: Array<{ value: PlaybackPeriodType; label: string }> = [
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
];
const TOP_EMPTY_TEXT: Record<PlaybackPeriodType, string> = {
  week: '这周还没有看过什么',
  month: '这个月还没有看过什么',
  year: '今年还没有看过什么',
};

function durationParts(seconds: number): Array<[number, string]> {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return [[minutes, '分钟']];
  const rest = minutes % 60;
  return rest > 0
    ? [
        [hours, '小时'],
        [rest, '分'],
      ]
    : [[hours, '小时']];
}

function formatDuration(seconds: number): string {
  return durationParts(seconds)
    .map(([value, unit]) => `${value} ${unit}`)
    .join(' ');
}

function formatDayLabel(key: string): string {
  const [, month, day] = key.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

function Metric({ label, seconds }: { label: string; seconds: number }) {
  return (
    <div className='min-w-0'>
      <p className='text-[13px] text-gray-500 dark:text-gray-400'>{label}</p>
      <p className='mt-1 flex items-baseline gap-0.5 whitespace-nowrap text-gray-900 dark:text-gray-50'>
        {durationParts(seconds).map(([value, unit]) => (
          <span key={unit} className='flex items-baseline gap-0.5'>
            <span className='text-[28px] font-semibold tabular-nums leading-none tracking-tight'>
              {value}
            </span>
            <span className='mr-1 text-[13px] text-gray-500 dark:text-gray-400'>
              {unit}
            </span>
          </span>
        ))}
      </p>
    </div>
  );
}

function WeekChart({
  buckets,
  today,
  selectedKey,
  onSelect,
}: {
  buckets: PlaybackPeriodBucket[];
  today: string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.watchSeconds));
  const highlightKey = selectedKey ?? today;

  return (
    <div className='grid flex-1 grid-cols-7 gap-1.5'>
      {buckets.map((bucket, index) => {
        const future = bucket.key > today;
        const highlighted = bucket.key === highlightKey;
        const ratio = bucket.watchSeconds / max;
        return (
          <button
            key={bucket.key}
            type='button'
            disabled={future}
            aria-pressed={bucket.key === selectedKey}
            aria-label={`${formatDayLabel(bucket.key)} ${formatDuration(bucket.watchSeconds)}`}
            onClick={() =>
              onSelect(bucket.key === selectedKey ? null : bucket.key)
            }
            className='group flex min-w-0 flex-col items-center gap-2 focus:outline-none'
          >
            <span className='flex h-20 w-full items-end justify-center md:h-auto md:min-h-20 md:flex-1'>
              {bucket.watchSeconds > 0 ? (
                <span
                  className={`w-full max-w-[28px] rounded-md transition-colors ${
                    highlighted
                      ? 'bg-brand-500 dark:bg-brand-400'
                      : 'bg-gray-200 group-hover:bg-gray-300 dark:bg-white/[0.12] dark:group-hover:bg-white/20'
                  }`}
                  style={{ height: `${Math.max(8, ratio * 100)}%` }}
                />
              ) : (
                <span
                  className={`h-1 w-full max-w-[28px] rounded-full ${
                    highlighted
                      ? 'bg-brand-500/40'
                      : 'bg-gray-200/70 dark:bg-white/[0.06]'
                  }`}
                />
              )}
            </span>
            <span
              className={`text-xs ${
                highlighted
                  ? 'font-medium text-gray-900 dark:text-gray-100'
                  : future
                    ? 'text-gray-300 dark:text-gray-600'
                    : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {bucket.key === today ? '今天' : WEEKDAY_LABELS[index]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TopWorkCard({
  work,
  rank,
  onOpen,
}: {
  work: PlaybackTopWork;
  rank: number;
  onOpen: (work: PlaybackTopWork) => void;
}) {
  return (
    <PlaybackPosterCard
      title={work.title}
      cover={work.cover || ''}
      coverSizes='(min-width: 640px) 160px, 25vw'
      source={work.source}
      videoId={work.videoId}
      year={work.year}
      rank={rank}
      subtitle={formatDuration(work.watchSeconds)}
      ariaLabel={`播放 ${work.title}`}
      onPlay={() => onOpen(work)}
    />
  );
}

// 占住一行海报的高度，空态与有内容之间切换时不跳动
function TopWorksMessage({ children }: { children: ReactNode }) {
  return (
    <div className='relative'>
      <ScrollableRow>
        <div
          aria-hidden='true'
          className={`invisible ${HOME_POSTER_CARD_CLASS}`}
        >
          <div className={POSTER_CARD_COVER_CLASS} />
          <p className={POSTER_CARD_TITLE_ROW_CLASS}>&nbsp;</p>
          <p className={POSTER_CARD_SUBTITLE_ROW_CLASS}>&nbsp;</p>
        </div>
      </ScrollableRow>
      <p className='absolute inset-0 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500'>
        {children}
      </p>
    </div>
  );
}

function TopWorks({ week }: { week: PlaybackPeriodStats }) {
  const router = useRouter();
  const [range, setRange] = useState<PlaybackPeriodType>('week');
  const [byRange, setByRange] = useState<
    Partial<Record<PlaybackPeriodType, PlaybackTopWork[]>>
  >(() => ({
    month: getCachedPlaybackPeriodSnapshot('month')?.topWorks,
    year: getCachedPlaybackPeriodSnapshot('year')?.topWorks,
  }));
  const [failed, setFailed] = useState(false);
  const worksOf = (value: PlaybackPeriodType) =>
    value === 'week' ? week.topWorks : byRange[value];
  // 新范围加载完成前继续展示上一份结果，避免占位与实际高度不同导致布局跳动
  const [shownRange, setShownRange] = useState<PlaybackPeriodType>('week');
  const loaded = worksOf(range) !== undefined;
  if (loaded && shownRange !== range) setShownRange(range);
  const works = worksOf(loaded ? range : shownRange) ?? [];
  const pending = !loaded && !failed;

  useEffect(() => {
    if (range === 'week') return;
    let active = true;
    setFailed(false);
    getPlaybackPeriodStats(range)
      .then((stats) => {
        if (active && stats)
          setByRange((previous) => ({ ...previous, [range]: stats.topWorks }));
      })
      .catch((error) => {
        console.error('获取常看内容失败:', error);
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [range]);

  const open = (work: PlaybackTopWork) => {
    const params = new URLSearchParams({
      source: work.source,
      id: work.videoId,
      title: work.title,
    });
    if (work.year) params.set('year', work.year);
    router.push(
      withReturnTo(`/play?${params.toString()}`, getCurrentNavigationPath()),
    );
  };

  return (
    <section className={STATS_COLUMN_CLASS}>
      <StatsHeading title='常看'>
        <div
          role='radiogroup'
          aria-label='常看范围'
          className='flex h-7 rounded-full bg-gray-900/[0.05] p-0.5 dark:bg-white/[0.06]'
        >
          {TOP_RANGE_OPTIONS.map((option) => {
            const selected = range === option.value;
            return (
              <button
                key={option.value}
                type='button'
                role='radio'
                aria-checked={selected}
                onClick={() => setRange(option.value)}
                className={`min-w-9 rounded-full px-2.5 text-xs transition-colors ${
                  selected
                    ? 'bg-white font-medium text-gray-900 shadow-sm dark:bg-white/[0.14] dark:text-white'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </StatsHeading>
      {failed && !loaded ? (
        <TopWorksMessage>加载失败，请稍后重试</TopWorksMessage>
      ) : works.length === 0 ? (
        <TopWorksMessage>
          {TOP_EMPTY_TEXT[loaded ? range : shownRange]}
        </TopWorksMessage>
      ) : (
        <div
          aria-busy={pending}
          className={`transition-opacity ${pending ? 'opacity-50' : ''}`}
        >
          <ScrollableRow>
            {works.map((work, index) => (
              <div
                key={`${work.source}+${work.videoId}`}
                className={HOME_POSTER_CARD_CLASS}
              >
                <TopWorkCard work={work} rank={index + 1} onOpen={open} />
              </div>
            ))}
          </ScrollableRow>
        </div>
      )}
    </section>
  );
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function PlaybackStatsPanel() {
  const [stats, setStats] = useState<PlaybackPeriodStats | null>(null);
  useIsomorphicLayoutEffect(() => {
    setStats(getCachedPlaybackPeriodSnapshot('week'));
  }, []);
  const [failed, setFailed] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getPlaybackPeriodStats('week')
      .then((data) => {
        if (active && data) setStats(data);
      })
      .catch((error) => {
        console.error('获取播放统计失败:', error);
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!stats) {
    return failed ? (
      <section>
        <StatsHeading title='观看统计' />
        <p className='py-6 text-sm text-gray-400 dark:text-gray-500'>
          统计加载失败，请稍后重试
        </p>
      </section>
    ) : (
      <PlaybackStatsSkeleton />
    );
  }

  const selected = stats.buckets.find((bucket) => bucket.key === selectedKey);

  return (
    <div className={STATS_LAYOUT_CLASS}>
      <section className={STATS_COLUMN_CLASS}>
        <StatsHeading title='观看统计' />
        <div className={STATS_CARD_CLASS}>
          <div className='flex flex-wrap gap-x-8 gap-y-3'>
            <Metric
              label={selected ? formatDayLabel(selected.key) : '本周'}
              seconds={selected ? selected.watchSeconds : stats.watchSeconds}
            />
            <Metric label='累计' seconds={stats.lifetimeWatchSeconds} />
          </div>
          <div className='mt-5 flex min-w-0 flex-1 flex-col'>
            <WeekChart
              buckets={stats.buckets}
              today={stats.date}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />
          </div>
        </div>
      </section>
      <TopWorks week={stats} />
    </div>
  );
}
