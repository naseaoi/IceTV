'use client';

import { RotateCcw } from 'lucide-react';
import Link from 'next/link';

import {
  RECAP_BUTTON,
  RECAP_RULE,
  RECAP_TEXT,
  RecapBackdrop,
  RecapCover,
  Rise,
  SlideBody,
} from '@/features/annual-report/components/RecapPrimitives';
import type { SlideProps } from '@/features/annual-report/components/slides/OverviewSlides';
import {
  dominantDaypart,
  durationParts,
  peakIndex,
} from '@/features/annual-report/lib/format';

export function SummarySlide({ report, nickname, onRestart }: SlideProps) {
  const { totals } = report;
  const { hours, minutes } = durationParts(totals.watchSeconds);
  const daypart = dominantDaypart(report.hours);
  const peakHour = peakIndex(report.hours);
  const stats = [
    { label: '活跃天数', value: `${totals.activeDays}`, unit: '天' },
    { label: '看过作品', value: `${totals.workCount}`, unit: '部' },
    {
      label: '最长连续',
      value: `${report.longestStreak?.days ?? 1}`,
      unit: '天',
    },
    {
      label: '最常看的时刻',
      value: peakHour >= 0 ? `${String(peakHour).padStart(2, '0')}:00` : '—',
      unit: '',
    },
  ];
  const otherYears = report.availableYears.filter(
    (year) => year !== report.year,
  );

  return (
    <>
      <RecapBackdrop tint='ice' at='bottom-right' />
      <SlideBody center>
        <Rise className='rounded-2xl bg-white p-6 shadow-[0_30px_60px_-36px_rgba(15,23,42,0.35)] ring-1 ring-gray-900/[0.06] dark:bg-gray-900 dark:shadow-none dark:ring-white/[0.08]'>
          <div
            className={`flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.22em] ${RECAP_TEXT.muted}`}
          >
            <span>IceTV Recap</span>
            <span className='tabular-nums'>{report.year}</span>
          </div>

          <div className='mt-6 flex items-center gap-2.5'>
            <span className='truncate text-lg font-medium'>{nickname}</span>
            {daypart && (
              <span className='shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700 dark:bg-brand-950 dark:text-brand-200'>
                {daypart.persona}
              </span>
            )}
          </div>

          <div className='mt-5 flex items-baseline gap-1.5'>
            <span className='text-[56px] font-extralight tabular-nums leading-none tracking-[-0.04em]'>
              {hours > 0 ? hours : minutes}
            </span>
            <span className={`text-sm ${RECAP_TEXT.secondary}`}>
              {hours > 0 ? '小时' : '分钟'}
            </span>
            {hours > 0 && minutes > 0 && (
              <>
                <span className='ml-1.5 text-[28px] font-extralight tabular-nums'>
                  {minutes}
                </span>
                <span className={`text-sm ${RECAP_TEXT.secondary}`}>分钟</span>
              </>
            )}
          </div>
          <div className={`mt-1.5 text-xs ${RECAP_TEXT.muted}`}>
            全年观看时长
          </div>

          <div
            className={`mt-6 grid grid-cols-2 gap-y-5 border-t pt-5 ${RECAP_RULE}`}
          >
            {stats.map((stat) => (
              <div key={stat.label}>
                <div className='flex items-baseline gap-1'>
                  <span className='text-[22px] font-light tabular-nums tracking-tight'>
                    {stat.value}
                  </span>
                  {stat.unit && (
                    <span className={`text-xs ${RECAP_TEXT.secondary}`}>
                      {stat.unit}
                    </span>
                  )}
                </div>
                <div className={`mt-1 text-xs ${RECAP_TEXT.muted}`}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {report.topWorks.length > 0 && (
            <div className={`mt-6 border-t pt-5 ${RECAP_RULE}`}>
              <div className={`text-xs ${RECAP_TEXT.muted}`}>年度常看</div>
              <div className='mt-3 grid grid-cols-3 gap-3'>
                {report.topWorks.slice(0, 3).map((work, index) => (
                  <div key={`${work.title}-${index}`} className='min-w-0'>
                    <RecapCover
                      cover={work.cover}
                      title={work.title}
                      className='w-full rounded-md'
                      sizes='120px'
                    />
                    <div
                      className={`mt-1.5 truncate text-xs ${RECAP_TEXT.secondary}`}
                    >
                      {work.title}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Rise>

        {report.possiblyIncomplete && (
          <Rise
            d={1}
            className={`mt-3 text-center text-xs ${RECAP_TEXT.muted}`}
          >
            部分早期观看数据已清理
          </Rise>
        )}

        <Rise
          d={2}
          className='mt-6 flex flex-wrap items-center justify-center gap-2.5'
        >
          <button
            type='button'
            onClick={onRestart}
            className={RECAP_BUTTON.primary}
          >
            <RotateCcw className='h-4 w-4' />
            再看一遍
          </button>
          {otherYears.slice(0, 2).map((year) => (
            <Link
              key={year}
              href={`/recap/${year}`}
              className={RECAP_BUTTON.secondary}
            >
              {year}
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
