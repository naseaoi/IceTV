'use client';

import { ChevronsUp, X } from 'lucide-react';
import Link from 'next/link';
import {
  type ComponentType,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type TouchEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { RECAP_TEXT } from '@/features/annual-report/components/RecapPrimitives';
import {
  type SlideProps,
  EmptySlide,
  IntroSlide,
  MonthsSlide,
  TimeSlide,
} from '@/features/annual-report/components/slides/OverviewSlides';
import {
  HoursSlide,
  NightSlide,
  PeakSlide,
  StreakSlide,
} from '@/features/annual-report/components/slides/RhythmSlides';
import { SummarySlide } from '@/features/annual-report/components/slides/SummarySlide';
import {
  JourneySlide,
  RankingSlide,
  ReviewsSlide,
  SourcesSlide,
  TopWorkSlide,
} from '@/features/annual-report/components/slides/WorkSlides';
import {
  type SlideKey,
  buildSlides,
} from '@/features/annual-report/lib/format';
import type { AnnualReport } from '@/features/playback-stats/types';

const SLIDES: Record<SlideKey, ComponentType<SlideProps>> = {
  intro: IntroSlide,
  time: TimeSlide,
  months: MonthsSlide,
  hours: HoursSlide,
  night: NightSlide,
  peak: PeakSlide,
  streak: StreakSlide,
  top: TopWorkSlide,
  ranking: RankingSlide,
  journey: JourneySlide,
  sources: SourcesSlide,
  reviews: ReviewsSlide,
  summary: SummarySlide,
  empty: EmptySlide,
};

// 与 recap.css 中 .recap-slide-exit 的时长对应，略长以保证离场动画播完
const EXIT_MS = 420;
const SWIPE_PX = 48;
const WHEEL_THRESHOLD = 30;
// 翻页后忽略滚轮，直到惯性滚动停下（两次事件间隔超过 WHEEL_GAP_MS）且锁定期已过
const WHEEL_LOCK_MS = 700;
const WHEEL_GAP_MS = 180;
const SWIPE_CLICK_GUARD_MS = 400;

// 桌面舞台只在宽高都足够时启用，手机横屏仍铺满
export function RecapShell({ children }: { children: ReactNode }) {
  return (
    <div
      className={`fixed inset-0 z-50 overflow-hidden bg-gray-50 dark:bg-gray-950 [@media(min-width:768px)_and_(min-height:600px)]:bg-gray-100 [@media(min-width:768px)_and_(min-height:600px)]:dark:bg-[#08090b]`}
    >
      <div
        className={`flex h-full items-center justify-center [@media(min-width:768px)_and_(min-height:600px)]:p-6`}
      >
        {children}
      </div>
    </div>
  );
}

export function RecapStageFrame({ children }: { children: ReactNode }) {
  return (
    <section
      className={`relative h-full w-full overflow-hidden bg-gray-50 dark:bg-gray-950 [@media(min-width:768px)_and_(min-height:600px)]:aspect-[9/16] [@media(min-width:768px)_and_(min-height:600px)]:h-[min(880px,calc(100dvh-3rem))] [@media(min-width:768px)_and_(min-height:600px)]:w-auto [@media(min-width:768px)_and_(min-height:600px)]:rounded-[28px] [@media(min-width:768px)_and_(min-height:600px)]:shadow-[0_40px_100px_-40px_rgba(15,23,42,0.35)] [@media(min-width:768px)_and_(min-height:600px)]:ring-1 [@media(min-width:768px)_and_(min-height:600px)]:ring-gray-900/[0.06] [@media(min-width:768px)_and_(min-height:600px)]:dark:shadow-none [@media(min-width:768px)_and_(min-height:600px)]:dark:ring-white/[0.06]`}
    >
      {children}
    </section>
  );
}

export function RecapHeader({ year }: { year: number }) {
  return (
    <div className='pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+1rem)]'>
      <div
        className={`pl-3 text-[11px] font-medium uppercase tracking-[0.22em] ${RECAP_TEXT.muted}`}
      >
        IceTV · {year}
      </div>
      <Link
        href='/me'
        aria-label='关闭年度报告'
        className='pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-900/[0.05] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
      >
        <X className='h-[18px] w-[18px]' strokeWidth={1.75} />
      </Link>
    </div>
  );
}

function scrollEdges(target: EventTarget | null): {
  atTop: boolean;
  atBottom: boolean;
} {
  const scroller =
    target instanceof Element ? target.closest('.recap-scroll') : null;
  if (!scroller) return { atTop: true, atBottom: true };
  return {
    atTop: scroller.scrollTop <= 1,
    atBottom:
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1,
  };
}

export function RecapStage({
  report,
  nickname,
}: {
  report: AnnualReport;
  nickname: string;
}) {
  const [slides] = useState(() => buildSlides(report));
  const [coarsePointer] = useState(
    () => window.matchMedia('(pointer: coarse)').matches,
  );
  const [view, setView] = useState({ index: 0, dir: 1 });
  const [exiting, setExiting] = useState<{ index: number; dir: number } | null>(
    null,
  );
  const exitTimerRef = useRef<number | undefined>(undefined);
  const touchRef = useRef<{
    x: number;
    y: number;
    atTop: boolean;
    atBottom: boolean;
  } | null>(null);
  const lastSwipeAtRef = useRef(0);
  const wheelRef = useRef({
    delta: 0,
    lastAt: 0,
    locked: false,
    lockUntil: 0,
  });

  const goTo = useCallback(
    (target: number) => {
      if (target === view.index || target < 0 || target >= slides.length)
        return false;
      const dir = target > view.index ? 1 : -1;
      setExiting({ index: view.index, dir });
      setView({ index: target, dir });
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = window.setTimeout(() => setExiting(null), EXIT_MS);
      return true;
    },
    [slides.length, view.index],
  );

  const next = useCallback(() => goTo(view.index + 1), [goTo, view.index]);
  const previous = useCallback(() => goTo(view.index - 1), [goTo, view.index]);
  const restart = useCallback(() => goTo(0), [goTo]);

  useEffect(() => () => window.clearTimeout(exitTimerRef.current), []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey
      ) {
        return;
      }
      if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(event.key)) {
        if (
          event.key === ' ' &&
          (event.target as HTMLElement).closest('button, a')
        ) {
          return;
        }
        event.preventDefault();
        next();
      } else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        previous();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [next, previous]);

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (event.touches.length !== 1 || !touch) {
      touchRef.current = null;
      return;
    }
    touchRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      ...scrollEdges(event.target),
    };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = touchRef.current;
    const touch = event.changedTouches[0];
    touchRef.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dy) < SWIPE_PX || Math.abs(dy) < Math.abs(dx) * 1.2) return;
    lastSwipeAtRef.current = Date.now();
    // 内容可滚动时先滚到尽头，再次滑动才翻页
    if (dy < 0 && start.atBottom) next();
    else if (dy > 0 && start.atTop) previous();
  };

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('a, button')) return;
    if (Date.now() - lastSwipeAtRef.current < SWIPE_CLICK_GUARD_MS) return;
    next();
  };

  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    const wheel = wheelRef.current;
    const now = event.timeStamp;
    const gap = now - wheel.lastAt;
    wheel.lastAt = now;
    if (wheel.locked) {
      if (gap < WHEEL_GAP_MS || now < wheel.lockUntil) return;
      wheel.locked = false;
      wheel.delta = 0;
    }
    if (gap > WHEEL_GAP_MS) wheel.delta = 0;
    wheel.delta += event.deltaY;
    if (Math.abs(wheel.delta) < WHEEL_THRESHOLD) return;
    const { atTop, atBottom } = scrollEdges(event.target);
    const down = wheel.delta > 0;
    wheel.delta = 0;
    if (down ? !atBottom : !atTop) return;
    if (down ? next() : previous()) {
      wheel.locked = true;
      wheel.lockUntil = now + WHEEL_LOCK_MS;
    }
  };

  const renderSlide = (index: number, className: string, dir: number) => {
    const Slide = SLIDES[slides[index]];
    return (
      <div
        key={`${slides[index]}-${index}`}
        role='group'
        aria-roledescription='slide'
        aria-label={`第 ${index + 1} 页，共 ${slides.length} 页`}
        aria-hidden={className === 'recap-slide-exit' || undefined}
        className={`absolute inset-0 ${className}`}
        style={{ '--dir': dir } as CSSProperties}
      >
        <Slide report={report} nickname={nickname} onRestart={restart} />
      </div>
    );
  };

  const isLast = view.index === slides.length - 1;

  return (
    <RecapShell>
      <RecapStageFrame>
        <div
          aria-roledescription='carousel'
          aria-label={`${report.year} 年度观影报告`}
          className='absolute inset-0 cursor-pointer select-none'
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={() => (touchRef.current = null)}
          onClick={handleClick}
          onWheel={handleWheel}
        >
          {exiting &&
            renderSlide(exiting.index, 'recap-slide-exit', exiting.dir)}
          {renderSlide(
            view.index,
            exiting ? 'recap-slide-enter' : '',
            view.dir,
          )}
        </div>

        <RecapHeader year={report.year} />

        {!isLast && (
          <button
            key={view.index}
            type='button'
            onClick={next}
            aria-label='下一页'
            className={`recap-fade absolute bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1 rounded-full px-4 py-1.5 text-xs tracking-[0.12em] transition-colors hover:text-gray-700 dark:hover:text-gray-200 ${RECAP_TEXT.muted}`}
            style={{ '--d': 10 } as CSSProperties}
          >
            <ChevronsUp
              aria-hidden
              className='recap-hint-float h-[18px] w-[18px]'
              strokeWidth={1.5}
            />
            {coarsePointer ? '上滑或点击翻页' : '滚动或点击翻页'}
          </button>
        )}
      </RecapStageFrame>
    </RecapShell>
  );
}
