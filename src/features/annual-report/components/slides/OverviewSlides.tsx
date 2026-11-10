'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';

import {
  CountUp,
  Figure,
  Headline,
  Kicker,
  Lead,
  RECAP_BUTTON,
  RECAP_RULE,
  RECAP_TEXT,
  RecapBackdrop,
  RecapCover,
  Rise,
  SlideBody,
} from '@/features/annual-report/components/RecapPrimitives';
import {
  durationParts,
  formatDuration,
  formatDurationShort,
  formatInstantDate,
  peakIndex,
  watchComparison,
} from '@/features/annual-report/lib/format';
import type { AnnualReport } from '@/features/playback-stats/types';

export type SlideProps = {
  report: AnnualReport;
  nickname: string;
  onRestart: () => void;
};

const INTRO_COVER_LIMIT = 5;

export function IntroSlide({ report, nickname }: SlideProps) {
  const covers = report.topWorks.slice(0, INTRO_COVER_LIMIT);
  return (
    <>
      <RecapBackdrop tint='ice' />
      <SlideBody>
        <div className='my-auto'>
          <Kicker>Annual Recap</Kicker>
          <Rise
            d={1}
            className='mt-8 text-[104px] font-extralight tabular-nums leading-[0.9] tracking-[-0.05em] sm:text-[120px]'
          >
            {report.year}
          </Rise>
          <Rise d={2} className={`mt-8 border-t pt-6 ${RECAP_RULE}`}>
            <div className='text-[22px] font-medium tracking-tight'>
              {nickname}的观影年鉴
            </div>
            <div className={`mt-2 text-[15px] ${RECAP_TEXT.secondary}`}>
              {report.inProgress
                ? `截至 ${formatInstantDate(report.generatedAt, report.timeZone)}`
                : '那些陪你度过的故事'}
            </div>
          </Rise>
        </div>

        {covers.length > 0 && (
          <div className='mt-10 flex shrink-0 gap-2.5'>
            {covers.map((work, index) => (
              <div
                key={`${work.title}-${index}`}
                className='recap-rise min-w-0 flex-1'
                style={{ '--d': 3 + index * 0.6 } as CSSProperties}
              >
                <RecapCover
                  cover={work.cover}
                  title={work.title}
                  className='w-full rounded-md'
                  sizes='96px'
                  priority
                />
              </div>
            ))}
            {Array.from(
              { length: INTRO_COVER_LIMIT - covers.length },
              (_, index) => (
                <div key={`empty-${index}`} className='flex-1' />
              ),
            )}
          </div>
        )}
      </SlideBody>
    </>
  );
}

export function TimeSlide({ report }: SlideProps) {
  const { totals } = report;
  const { hours, minutes } = durationParts(totals.watchSeconds);
  const comparison = watchComparison(totals.watchSeconds);
  const stats = [
    { value: totals.activeDays, unit: '天', label: '活跃天数' },
    { value: totals.workCount, unit: '部', label: '看过的作品' },
    { value: totals.episodeCount, unit: '集', label: '看过的集数' },
  ];
  return (
    <>
      <RecapBackdrop tint='ice' at='top-left' />
      <SlideBody center>
        <Kicker>Watch Time</Kicker>
        <Lead d={1} className='mt-6'>
          这一年，你在 IceTV {totals.estimatedWatchSeconds > 0 ? '大约' : ''}
          看了
        </Lead>
        <Rise d={2} className='mt-4 flex flex-wrap items-baseline gap-x-4'>
          {hours > 0 && <Figure value={hours} unit='小时' />}
          {(minutes > 0 || hours === 0) && (
            <Figure
              value={minutes}
              unit='分钟'
              size={hours > 0 ? 'md' : 'lg'}
              delay={560}
            />
          )}
        </Rise>
        {comparison && (
          <Rise d={3} className={`mt-5 text-[15px] ${RECAP_TEXT.accent}`}>
            {comparison}
          </Rise>
        )}
        <Rise
          d={4}
          className={`mt-14 grid grid-cols-3 divide-x divide-gray-900/[0.08] border-t pt-6 dark:divide-white/[0.08] ${RECAP_RULE}`}
        >
          {stats.map((stat, index) => (
            <div key={stat.label} className={index === 0 ? 'pr-4' : 'px-4'}>
              <div className='flex items-baseline gap-1'>
                <span className='text-[30px] font-light leading-none tracking-tight'>
                  <CountUp value={stat.value} delay={760 + index * 140} />
                </span>
                <span className={`text-xs ${RECAP_TEXT.secondary}`}>
                  {stat.unit}
                </span>
              </div>
              <div className={`mt-2 text-xs ${RECAP_TEXT.muted}`}>
                {stat.label}
              </div>
            </div>
          ))}
        </Rise>
      </SlideBody>
    </>
  );
}

export function MonthsSlide({ report }: SlideProps) {
  const peak = peakIndex(report.months);
  const max = Math.max(...report.months, 1);
  return (
    <>
      <RecapBackdrop tint='mist' />
      <SlideBody center>
        <Kicker>Monthly</Kicker>
        <Headline d={1} className='mt-6'>
          {peak + 1} 月，是你看得最多的一个月
        </Headline>
        <Lead d={2} className='mt-2'>
          这个月一共看了 {formatDuration(report.months[peak])}
        </Lead>
        <Rise d={3} className='mt-14'>
          <div className='flex h-48 items-end justify-between'>
            {report.months.map((value, index) => {
              const isPeak = index === peak;
              const height = value > 0 ? Math.max(3, (value / max) * 100) : 0;
              return (
                <div
                  key={index}
                  className='relative flex h-full w-[14px] flex-col items-center justify-end'
                >
                  {isPeak && (
                    <div
                      className={`recap-fade absolute -top-6 whitespace-nowrap text-[11px] tabular-nums ${RECAP_TEXT.accent}`}
                      style={{ '--d': 6 } as CSSProperties}
                    >
                      {formatDurationShort(value)}
                    </div>
                  )}
                  <div
                    className={`recap-grow-y w-[6px] rounded-full ${
                      isPeak
                        ? 'bg-brand-500 dark:bg-brand-300'
                        : height > 0
                          ? 'bg-gray-300 dark:bg-gray-700'
                          : 'bg-gray-200 dark:bg-gray-800'
                    }`}
                    style={
                      {
                        '--d': index,
                        height: height > 0 ? `${height}%` : '3px',
                      } as CSSProperties
                    }
                  />
                </div>
              );
            })}
          </div>
          <div
            className={`mt-3 flex justify-between border-t pt-2.5 ${RECAP_RULE}`}
          >
            {report.months.map((_, index) => (
              <div
                key={index}
                className={`w-[14px] text-center text-[10px] tabular-nums ${index === peak ? RECAP_TEXT.primary : RECAP_TEXT.muted}`}
              >
                {index + 1}
              </div>
            ))}
          </div>
        </Rise>
      </SlideBody>
    </>
  );
}

export function EmptySlide({ report }: SlideProps) {
  const otherYears = report.availableYears.filter(
    (year) => year !== report.year,
  );
  return (
    <>
      <RecapBackdrop tint='ice' />
      <SlideBody center>
        <Kicker>Annual Recap</Kicker>
        <Rise
          d={1}
          className='mt-8 text-[96px] font-extralight tabular-nums leading-none tracking-[-0.05em]'
        >
          {report.year}
        </Rise>
        <Rise d={2} className={`mt-8 border-t pt-6 text-lg ${RECAP_RULE}`}>
          这一年还没有观看记录
        </Rise>
        <Rise d={3} className='mt-10 flex flex-wrap gap-2.5'>
          {otherYears.map((year) => (
            <Link
              key={year}
              href={`/recap/${year}`}
              className={RECAP_BUTTON.secondary}
            >
              看看 {year}
            </Link>
          ))}
          <Link href='/me' className={RECAP_BUTTON.secondary}>
            返回我的
          </Link>
        </Rise>
      </SlideBody>
    </>
  );
}
