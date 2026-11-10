'use client';

import type { CSSProperties } from 'react';

import { HourDial } from '@/features/annual-report/components/HourDial';
import {
  type RecapTint,
  Figure,
  Headline,
  Kicker,
  Lead,
  RECAP_RULE,
  RECAP_TEXT,
  RecapBackdrop,
  RecapCover,
  Rise,
  SlideBody,
} from '@/features/annual-report/components/RecapPrimitives';
import type { SlideProps } from '@/features/annual-report/components/slides/OverviewSlides';
import {
  type DaypartKey,
  dominantDaypart,
  formatClock,
  formatDate,
  formatDuration,
  formatDurationShort,
  formatInstantDate,
  peakIndex,
  share,
} from '@/features/annual-report/lib/format';

const DAYPART_TINT: Record<DaypartKey, RecapTint> = {
  dawn: 'sand',
  morning: 'frost',
  noon: 'frost',
  afternoon: 'frost',
  evening: 'dusk',
  night: 'night',
};

export function HoursSlide({ report, audience }: SlideProps) {
  const daypart = dominantDaypart(report.hours);
  const peakHour = peakIndex(report.hours);
  const daypartSeconds = daypart
    ? report.hours.reduce((sum, value, hour) => {
        const inRange =
          daypart.start < daypart.end
            ? hour >= daypart.start && hour < daypart.end
            : hour >= daypart.start || hour < daypart.end;
        return inRange ? sum + value : sum;
      }, 0)
    : 0;
  const weekTotal = report.weekdays.reduce((sum, value) => sum + value, 0);
  const weekendShare = share(
    report.weekdays[5] + report.weekdays[6],
    weekTotal,
  );

  return (
    <>
      <RecapBackdrop tint={DAYPART_TINT[daypart?.key ?? 'evening']} />
      <SlideBody center>
        <Kicker>Hours</Kicker>
        <Headline d={1} className='mt-6'>
          {audience.you}是「{daypart?.persona ?? '黄金档主角'}」
        </Headline>
        {daypart && (
          <Lead d={2} className='mt-2'>
            {daypart.range}的观看占全年{' '}
            {share(daypartSeconds, report.totals.watchSeconds)}%
          </Lead>
        )}
        <Rise d={3} className='mt-8'>
          <HourDial
            hours={report.hours}
            peakHour={peakHour}
            highlight={daypart}
          >
            <div className='text-[34px] font-extralight tabular-nums leading-none tracking-tight'>
              {String(peakHour).padStart(2, '0')}:00
            </div>
            <div className={`mt-2 text-[11px] ${RECAP_TEXT.muted}`}>
              最常看的时刻
            </div>
          </HourDial>
        </Rise>
        {weekTotal > 0 && (
          <Rise d={5} className='mt-8'>
            <div className='flex h-[3px] overflow-hidden rounded-full bg-gray-900/[0.06] dark:bg-white/[0.08]'>
              <div
                className='recap-grow-x h-full rounded-full bg-gray-400 dark:bg-gray-500'
                style={{ width: `${100 - weekendShare}%` } as CSSProperties}
              />
            </div>
            <div
              className={`mt-2.5 flex justify-between text-xs tabular-nums ${RECAP_TEXT.secondary}`}
            >
              <span>工作日 {100 - weekendShare}%</span>
              <span>周末 {weekendShare}%</span>
            </div>
          </Rise>
        )}
      </SlideBody>
    </>
  );
}

export function NightSlide({ report, audience }: SlideProps) {
  const night = report.latestNight!;
  return (
    <>
      <RecapBackdrop tint='night' at='top-left' />
      <SlideBody center>
        <Kicker>Late Night</Kicker>
        <Lead d={1} className='mt-6'>
          {formatInstantDate(night.at, report.timeZone)}
        </Lead>
        <Headline d={2} className='mt-1'>
          {formatClock(night.localTime)}，{audience.you}还在看
        </Headline>
        <Rise d={3} className='mt-10 flex items-end gap-5'>
          <RecapCover
            cover={night.cover}
            title={night.title}
            className='w-28 rounded-lg shadow-[0_18px_40px_-18px_rgba(15,23,42,0.45)]'
          />
          <div className='min-w-0 pb-1'>
            <div className='line-clamp-3 text-xl font-medium leading-snug'>
              {night.title}
            </div>
          </div>
        </Rise>
        {report.lateNightWatchSeconds > 0 && (
          <Lead d={4} className={`mt-10 border-t pt-5 ${RECAP_RULE}`}>
            这一年，有 {formatDuration(report.lateNightWatchSeconds)}
            是在凌晨度过的。
            <br />
            追剧之余，也记得早点休息。
          </Lead>
        )}
      </SlideBody>
    </>
  );
}

export function PeakSlide({ report, audience }: SlideProps) {
  const peak = report.peakDay!;
  return (
    <>
      <RecapBackdrop tint='sand' />
      <SlideBody center>
        <Kicker>Peak Day</Kicker>
        <Rise
          d={1}
          className='mt-6 text-[52px] font-extralight leading-none tracking-[-0.03em]'
        >
          {formatDate(peak.date)}
        </Rise>
        <Lead d={2} className='mt-4'>
          这一天，{audience.you}看了
          <span className={`mx-1 ${RECAP_TEXT.accent}`}>
            {formatDuration(peak.watchSeconds)}
          </span>
        </Lead>
        <div
          className={`mt-10 divide-y divide-gray-900/[0.08] border-y dark:divide-white/[0.08] ${RECAP_RULE}`}
        >
          {peak.works.map((work, index) => (
            <Rise
              key={`${work.title}-${index}`}
              d={3 + index}
              className='flex items-center gap-4 py-3'
            >
              <RecapCover
                cover={work.cover}
                title={work.title}
                className='w-10 rounded'
                sizes='40px'
              />
              <div className='min-w-0 flex-1 truncate text-[15px]'>
                {work.title}
              </div>
              <div
                className={`shrink-0 text-xs tabular-nums ${RECAP_TEXT.secondary}`}
              >
                {formatDurationShort(work.watchSeconds)}
              </div>
            </Rise>
          ))}
        </div>
      </SlideBody>
    </>
  );
}

const STREAK_DOT_LIMIT = 35;

// 日期串按 UTC 日历推算，不受本机时区影响
function dayOfMonth(startDate: string, offset: number): number {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.getUTCDate();
}

export function StreakSlide({ report }: SlideProps) {
  const streak = report.longestStreak!;
  const dots = Math.min(streak.days, STREAK_DOT_LIMIT);
  return (
    <>
      <RecapBackdrop tint='sage' at='top-left' />
      <SlideBody center>
        <Kicker>Streak</Kicker>
        <Lead d={1} className='mt-6'>
          最长连续观看
        </Lead>
        <Rise d={2} className='mt-3'>
          <Figure value={streak.days} unit='天' />
        </Rise>
        <Lead d={3} className='mt-4'>
          {formatDate(streak.startDate)} – {formatDate(streak.endDate)}
          ，每天都没有错过
        </Lead>
        <div className='mt-10 grid w-fit grid-cols-7 gap-2.5'>
          {Array.from({ length: dots }, (_, index) => (
            <span
              key={index}
              className='recap-fade flex h-9 w-9 items-center justify-center rounded-full text-[11px] tabular-nums text-brand-700 ring-1 ring-brand-500/35 dark:text-brand-200 dark:ring-brand-300/30'
              style={{ '--d': 4 + index * 0.18 } as CSSProperties}
            >
              {dayOfMonth(streak.startDate, index)}
            </span>
          ))}
        </div>
        {streak.days > STREAK_DOT_LIMIT && (
          <Lead d={6} className='mt-3 text-right text-xs'>
            …还有 {streak.days - STREAK_DOT_LIMIT} 天
          </Lead>
        )}
        <Rise
          d={7}
          className={`mt-8 border-t pt-5 text-[13px] ${RECAP_RULE} ${RECAP_TEXT.muted}`}
        >
          全年共有 {report.totals.activeDays} 天打开过 IceTV
        </Rise>
      </SlideBody>
    </>
  );
}
