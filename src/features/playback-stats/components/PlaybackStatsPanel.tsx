'use client';

import { Flame } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';

import {
  HOME_POSTER_CARD_CLASS,
  POSTER_CARD_COVER_CLASS,
  POSTER_CARD_SUBTITLE_ROW_CLASS,
  POSTER_CARD_TITLE_ROW_CLASS,
} from '@/components/poster-card-layout';
import ScrollableRow from '@/components/ScrollableRow';
import { RecapEntryLink } from '@/features/annual-report/components/RecapEntryLink';
import { PlaybackPosterCard } from '@/features/playback-stats/components/PlaybackPosterCard';
import {
  HOUR_STRIP_AXIS_CLASS,
  HOUR_STRIP_CELLS_CLASS,
  HOUR_STRIP_CLASS,
  METRIC_CLASS,
  METRIC_LABEL_CLASS,
  METRIC_NUMBER_CLASS,
  METRIC_ROW_CLASS,
  METRIC_UNIT_CLASS,
  METRIC_VALUE_CLASS,
  PlaybackStatsSkeleton,
  STATS_CARD_CLASS,
  STATS_COLUMN_CLASS,
  STATS_LAYOUT_CLASS,
  StatsHeading,
  WEEK_CHART_CLASS,
  WEEK_DAY_CLASS,
  WEEK_LABEL_CLASS,
  WEEK_TRACK_CLASS,
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
  INDICATOR_TARGET_ATTR,
  useSlidingIndicator,
} from '@/hooks/useSlidingIndicator';
import { openAnnualReportYear } from '@/lib/annual-report-window';
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

// 海报副标题较窄：剧集带集数，时长只取一个单位
function formatTopWorkSubtitle(work: PlaybackTopWork): string {
  const minutes = Math.floor(Math.max(0, work.watchSeconds) / 60);
  if (!(work.episodeCount > 1)) return formatDuration(work.watchSeconds);
  const time =
    minutes >= 60 ? `${Math.floor(minutes / 60)} 小时` : `${minutes} 分钟`;
  return `${work.episodeCount} 集 · ${time}`;
}

function formatDayLabel(key: string): string {
  const [, month, day] = key.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

const METRIC_TONE = {
  primary: {
    label:
      'bg-brand-500/10 text-brand-600 dark:bg-brand-400/15 dark:text-brand-300',
    number: 'text-gray-900 dark:text-gray-50',
  },
  secondary: {
    label: 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400',
    number: 'text-gray-700 dark:text-gray-300',
  },
} as const;

function Metric({
  label,
  seconds,
  variant,
}: {
  label: string;
  seconds: number;
  variant: keyof typeof METRIC_TONE;
}) {
  const tone = METRIC_TONE[variant];
  return (
    <div className={METRIC_CLASS}>
      <span className={`${METRIC_LABEL_CLASS} ${tone.label}`}>{label}</span>
      <span className={METRIC_VALUE_CLASS}>
        {durationParts(seconds).map(([value, unit]) => (
          <span key={unit} className='flex items-baseline gap-0.5'>
            <span
              className={`${METRIC_NUMBER_CLASS[variant]} tabular-nums ${tone.number}`}
            >
              {value}
            </span>
            <span
              className={`${METRIC_UNIT_CLASS} text-gray-500 dark:text-gray-400`}
            >
              {unit}
            </span>
          </span>
        ))}
      </span>
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
    <div className={WEEK_CHART_CLASS}>
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
            className={`group ${WEEK_DAY_CLASS} focus:outline-none`}
          >
            <span
              className={`${WEEK_TRACK_CLASS} transition-colors group-focus-visible:ring-2 group-focus-visible:ring-brand-500/60 ${
                future
                  ? 'bg-gray-100/50 dark:bg-white/[0.02]'
                  : 'bg-gray-100 group-hover:bg-gray-200/70 dark:bg-white/[0.04] dark:group-hover:bg-white/[0.07]'
              }`}
            >
              {bucket.watchSeconds > 0 && (
                <span
                  className={`w-full rounded-md transition-colors ${
                    highlighted
                      ? 'bg-brand-500 dark:bg-brand-400'
                      : 'bg-brand-500/25 group-hover:bg-brand-500/40 dark:bg-brand-400/25 dark:group-hover:bg-brand-400/40'
                  }`}
                  style={{ height: `${ratio * 100}%`, minHeight: 6 }}
                />
              )}
            </span>
            <span
              className={`${WEEK_LABEL_CLASS} ${
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

const HOUR_AXIS_MARKS = [0, 6, 12, 18, 24];

function HourStrip({ hours }: { hours: number[] }) {
  const max = Math.max(...hours);
  const peak = max > 0 ? hours.indexOf(max) : -1;
  return (
    <div
      className={HOUR_STRIP_CLASS}
      role='img'
      aria-label={
        peak >= 0 ? `最常在 ${peak} 点到 ${peak + 1} 点观看` : '暂无观看时段'
      }
    >
      <div className={HOUR_STRIP_CELLS_CLASS}>
        {hours.map((seconds, hour) => {
          const ratio = max > 0 ? seconds / max : 0;
          return (
            <span
              key={hour}
              title={`${hour}:00–${hour + 1}:00 · ${formatDuration(seconds)}`}
              className={`min-w-0 flex-1 rounded-[3px] ${
                seconds > 0
                  ? 'bg-brand-500 dark:bg-brand-400'
                  : 'bg-gray-100 dark:bg-white/[0.06]'
              }`}
              style={
                seconds > 0 && hour !== peak
                  ? { opacity: 0.18 + ratio * 0.6 }
                  : undefined
              }
            />
          );
        })}
      </div>
      <div
        aria-hidden='true'
        className={`${HOUR_STRIP_AXIS_CLASS} text-gray-400 dark:text-gray-500`}
      >
        {HOUR_AXIS_MARKS.map((hour, index) => (
          <span
            key={hour}
            className={`absolute ${
              index === 0
                ? 'left-0'
                : index === HOUR_AXIS_MARKS.length - 1
                  ? 'right-0'
                  : '-translate-x-1/2'
            }`}
            style={
              index > 0 && index < HOUR_AXIS_MARKS.length - 1
                ? { left: `${(hour / 24) * 100}%` }
                : undefined
            }
          >
            {hour}点
          </span>
        ))}
      </div>
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
      subtitle={formatTopWorkSubtitle(work)}
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

function rangeOrder(value: PlaybackPeriodType) {
  return TOP_RANGE_OPTIONS.findIndex((option) => option.value === value);
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
  // 展示的范围变化时卡片沿切换方向依次滑入；首次展示不播放
  const [swap, setSwap] = useState({ range: shownRange, shift: 0 });
  if (swap.range !== shownRange) {
    setSwap({
      range: shownRange,
      shift: rangeOrder(shownRange) > rangeOrder(swap.range) ? 1 : -1,
    });
  }
  const indicator = useSlidingIndicator<HTMLDivElement>(range);

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
          ref={indicator.containerRef}
          role='radiogroup'
          aria-label='常看范围'
          className='relative flex h-7 rounded-full bg-gray-900/[0.05] p-0.5 dark:bg-white/[0.06]'
        >
          {indicator.indicatorProps && (
            <span
              aria-hidden='true'
              ref={indicator.indicatorProps.ref}
              style={{ ...indicator.indicatorProps.style, top: undefined }}
              className='sliding-indicator bottom-0.5 top-0.5 rounded-full bg-white shadow-sm dark:bg-white/[0.14]'
            />
          )}
          {TOP_RANGE_OPTIONS.map((option) => {
            const selected = range === option.value;
            return (
              <button
                key={option.value}
                type='button'
                role='radio'
                aria-checked={selected}
                {...(selected ? { [INDICATOR_TARGET_ATTR]: '' } : {})}
                onClick={() => setRange(option.value)}
                className={`relative min-w-9 rounded-full px-2.5 text-xs transition-colors ${
                  selected
                    ? 'font-medium text-gray-900 dark:text-white'
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
          key={shownRange}
          aria-busy={pending}
          className={`transition-opacity ${pending ? 'opacity-50' : ''}`}
          style={{ '--swap-shift': `${swap.shift * 28}px` } as CSSProperties}
        >
          <ScrollableRow>
            {works.map((work, index) => (
              <div
                key={`${work.source}+${work.videoId}`}
                className={`${HOME_POSTER_CARD_CLASS} ${
                  swap.shift ? 'motion-swap-in' : ''
                }`}
                style={{ '--stagger-index': index } as CSSProperties}
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
  const reportYear = openAnnualReportYear(stats.date);
  // 会话缓存里可能是新增字段前的旧快照
  const streak = stats.currentStreak ?? 0;
  const hours =
    stats.hours?.length === 24 ? stats.hours : Array<number>(24).fill(0);

  return (
    <div className={STATS_LAYOUT_CLASS}>
      <section className={STATS_COLUMN_CLASS}>
        <StatsHeading title='观看统计'>
          <div className='flex items-center gap-3'>
            {streak >= 2 && (
              <span className='inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400'>
                <Flame className='h-3.5 w-3.5 text-brand-500 dark:text-brand-300' />
                连续{' '}
                <span className='font-medium tabular-nums text-gray-900 dark:text-gray-100'>
                  {streak}
                </span>{' '}
                天
              </span>
            )}
            {reportYear !== null && (
              <RecapEntryLink href={`/recap/${reportYear}`} year={reportYear} />
            )}
          </div>
        </StatsHeading>
        <div className={STATS_CARD_CLASS}>
          <div className={METRIC_ROW_CLASS}>
            <Metric
              variant='primary'
              label={selected ? formatDayLabel(selected.key) : '本周'}
              seconds={selected ? selected.watchSeconds : stats.watchSeconds}
            />
            <Metric
              variant='secondary'
              label='累计'
              seconds={stats.lifetimeWatchSeconds}
            />
          </div>
          <WeekChart
            buckets={stats.buckets}
            today={stats.date}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
          <HourStrip hours={hours} />
        </div>
      </section>
      <TopWorks week={stats} />
    </div>
  );
}
