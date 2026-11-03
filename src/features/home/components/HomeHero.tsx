'use client';

import { ExternalLink, Play, Star } from 'lucide-react';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import CoverImage from '@/components/CoverImage';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import { useIsMobileViewport } from '@/hooks/useIsMobileViewport';
import {
  buildExternalSubjectUrl,
  hasDisplayableRate,
  usePosterPlay,
} from '@/hooks/usePosterPlay';

import type { HomeHeroItem } from '../lib/home-hero';

const ROTATE_INTERVAL_MS = 8000;

function heroMetaParts(item: HomeHeroItem): string[] {
  return [
    item.year,
    item.region,
    item.genres?.slice(0, 3).join(' / '),
    item.episodesInfo,
  ].filter((part): part is string => Boolean(part));
}

function heroCredits(item: HomeHeroItem): string {
  return [
    item.directors && `导演 ${item.directors}`,
    item.actors && `主演 ${item.actors}`,
  ]
    .filter(Boolean)
    .join('　');
}

function HeroRate({ rate, className }: { rate: string; className: string }) {
  if (!hasDisplayableRate(rate)) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold tabular-nums text-amber-500 dark:text-amber-300 ${className}`}
    >
      <Star className='h-[1em] w-[1em] fill-current' />
      {rate}
    </span>
  );
}

function HeroMetaLine({
  item,
  className,
}: {
  item: HomeHeroItem;
  className: string;
}) {
  const parts = heroMetaParts(item);
  return (
    <p className={`flex min-w-0 items-center gap-x-2 ${className}`}>
      <HeroRate rate={item.rate} className='shrink-0' />
      {parts.length > 0 && (
        <span className='truncate text-gray-600 dark:text-gray-300'>
          {parts.join(' · ')}
        </span>
      )}
    </p>
  );
}

function HeroActions({ item }: { item: HomeHeroItem }) {
  const { play, prefetch, cancelPrefetch } = usePosterPlay({
    title: item.title,
    year: item.year,
    type: item.type,
  });
  const externalUrl = buildExternalSubjectUrl(Number(item.id));

  return (
    <div className='mt-7 flex items-center gap-3'>
      <button
        type='button'
        onClick={play}
        onMouseEnter={prefetch}
        onMouseLeave={cancelPrefetch}
        onFocus={prefetch}
        onBlur={cancelPrefetch}
        className='inline-flex h-11 items-center gap-2 rounded-full bg-brand-500 pl-5 pr-6 text-[15px] font-medium text-white shadow-lg shadow-brand-500/25 transition-colors hover:bg-brand-600'
      >
        <Play className='h-4 w-4 fill-current' />
        立即播放
      </button>
      {externalUrl && (
        <a
          href={externalUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex h-11 items-center gap-2 rounded-full bg-gray-900/[0.06] px-5 text-[15px] text-gray-700 transition-colors hover:bg-gray-900/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15'
        >
          豆瓣
          <ExternalLink className='h-3.5 w-3.5' />
        </a>
      )}
    </div>
  );
}

function HeroSlideContent({
  item,
  priority,
}: {
  item: HomeHeroItem;
  priority: boolean;
}) {
  const credits = heroCredits(item);

  return (
    <>
      <div className='relative aspect-[2/3] w-48 shrink-0 overflow-hidden rounded-xl shadow-2xl shadow-black/30 ring-1 ring-black/5 dark:ring-white/10 lg:w-56'>
        <CoverImage
          src={item.poster}
          alt={item.title}
          sizes='(min-width: 1024px) 224px, 192px'
          priority={priority}
        />
      </div>

      <div className='min-w-0 max-w-2xl flex-1 pb-1'>
        <p className='text-xs font-medium tracking-wider text-brand-600 dark:text-brand-300'>
          {item.label}
        </p>
        <h2 className='mt-2 line-clamp-2 text-4xl font-bold tracking-tight text-gray-900 dark:text-white lg:text-5xl lg:leading-tight'>
          {item.title}
        </h2>
        <HeroMetaLine item={item} className='mt-3 text-[15px]' />
        {item.intro && (
          <p className='mt-4 line-clamp-3 text-[15px] leading-7 text-gray-700 dark:text-gray-300'>
            {item.intro}
          </p>
        )}
        {credits && (
          <p className='mt-3 truncate text-sm text-gray-500 dark:text-gray-400'>
            {credits}
          </p>
        )}
        <HeroActions item={item} />
      </div>
    </>
  );
}

interface HeroSlideState {
  index: number;
  // 正在滑出的上一张，动画结束后清空
  previous: number | null;
  direction: 1 | -1;
  // 每次切换递增；当前张 key 为 seq、上一张为 seq - 1，切换时复用同一节点改播滑出动画
  seq: number;
}

const SLIDE_CLASS =
  'absolute inset-0 flex items-end gap-10 pb-10 pt-24 motion-reduce:animate-none';

function DesktopHero({
  items,
  priority,
}: {
  items: HomeHeroItem[];
  priority: boolean;
}) {
  const [slide, setSlide] = useState<HeroSlideState>({
    index: 0,
    previous: null,
    direction: 1,
    seq: 0,
  });
  const [paused, setPaused] = useState(false);
  const count = items.length;
  const activeIndex = Math.min(slide.index, count - 1);

  const goTo = useCallback((target: number, direction: 1 | -1) => {
    setSlide((state) =>
      target === state.index
        ? state
        : {
            index: target,
            previous: state.index,
            direction,
            seq: state.seq + 1,
          },
    );
  }, []);

  // 依赖 seq：手动切换后重新计时，避免刚点完就被自动轮播带走
  useEffect(() => {
    if (paused || count < 2) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        goTo((activeIndex + 1) % count, 1);
      }
    }, ROTATE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeIndex, count, goTo, paused, slide.seq]);

  const finishLeaving = (seq: number) => {
    setSlide((state) =>
      state.seq === seq && state.previous !== null
        ? { ...state, previous: null }
        : state,
    );
  };

  const slideStyle = { '--hero-dir': slide.direction } as CSSProperties;
  const previousItem =
    slide.previous !== null && slide.previous < count
      ? items[slide.previous]
      : null;

  return (
    <section
      aria-roledescription='carousel'
      aria-label='精选'
      className='relative -mt-16 hidden overflow-hidden md:block'
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className='absolute inset-0' aria-hidden='true'>
        {items.map((item, index) => (
          <div
            key={item.id}
            className={`absolute inset-0 scale-125 blur-3xl transition-opacity duration-1000 ${
              index === activeIndex ? 'opacity-60 dark:opacity-45' : 'opacity-0'
            }`}
          >
            <CoverImage src={item.poster} alt='' sizes='128px' />
          </div>
        ))}
        <div className='absolute inset-0 bg-gradient-to-r from-gray-50/90 via-gray-50/60 to-gray-50/10 dark:from-gray-950/90 dark:via-gray-950/60 dark:to-gray-950/10' />
        <div className='absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-gray-50 to-transparent dark:from-gray-950' />
      </div>

      <div
        className={`${PAGE_CONTAINER_CLASS} relative flex h-[clamp(440px,58vh,560px)] items-end gap-10`}
      >
        <div className='relative h-full min-w-0 flex-1'>
          {previousItem && (
            <div
              key={slide.seq - 1}
              aria-hidden='true'
              inert
              style={slideStyle}
              className={`${SLIDE_CLASS} pointer-events-none animate-hero-slide-out motion-reduce:hidden`}
              onAnimationEnd={() => finishLeaving(slide.seq)}
            >
              <HeroSlideContent item={previousItem} priority={false} />
            </div>
          )}
          <div
            key={slide.seq}
            aria-roledescription='slide'
            aria-label={`${activeIndex + 1} / ${count}`}
            style={slideStyle}
            className={`${SLIDE_CLASS} ${
              slide.seq > 0 ? 'animate-hero-slide-in' : ''
            }`}
          >
            <HeroSlideContent
              item={items[activeIndex]}
              priority={priority && activeIndex === 0}
            />
          </div>
        </div>

        {count > 1 && (
          <div
            className='relative z-10 hidden shrink-0 items-end gap-2 self-end pb-10 lg:flex'
            role='tablist'
            aria-label='切换精选'
          >
            {items.map((item, index) => (
              <button
                key={item.id}
                type='button'
                role='tab'
                aria-selected={index === activeIndex}
                aria-label={item.title}
                onClick={() => goTo(index, index > activeIndex ? 1 : -1)}
                className={`relative aspect-[2/3] overflow-hidden rounded-md transition-all duration-300 ${
                  index === activeIndex
                    ? 'w-14 opacity-100 ring-2 ring-brand-400 ring-offset-2 ring-offset-gray-50 dark:ring-offset-gray-950'
                    : 'w-11 opacity-50 hover:opacity-90'
                }`}
              >
                <CoverImage src={item.poster} alt='' sizes='64px' />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const MOBILE_HERO_HEIGHT_CLASS = 'h-[min(125vw,72vh)]';
const MOBILE_ROTATE_INTERVAL_MS = 6000;

function MobileHeroSlide({
  item,
  priority,
}: {
  item: HomeHeroItem;
  priority: boolean;
}) {
  const { play } = usePosterPlay({
    title: item.title,
    year: item.year,
    type: item.type,
  });

  return (
    <div
      aria-roledescription='slide'
      className={`relative w-full shrink-0 snap-center snap-always ${MOBILE_HERO_HEIGHT_CLASS}`}
    >
      <button
        type='button'
        tabIndex={-1}
        aria-hidden='true'
        onClick={play}
        className='absolute inset-0'
      >
        <CoverImage
          src={item.poster}
          alt=''
          sizes='100vw'
          priority={priority}
        />
      </button>
      {/* 顶部压暗保证透明顶栏上的白字在浅色海报上也可读 */}
      <div className='pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/60 via-black/25 to-transparent' />
      <div className='pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-gray-50 via-gray-50/80 to-transparent dark:from-gray-950 dark:via-gray-950/80' />

      <div className='pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4'>
        <p className='inline-flex rounded bg-brand-500 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white'>
          {item.label}
        </p>
        <h2 className='mt-2 line-clamp-2 text-[28px] font-bold leading-tight tracking-tight text-gray-900 dark:text-white'>
          {item.title}
        </h2>
        <HeroMetaLine item={item} className='mt-1.5 text-[13px]' />
        {item.intro && (
          <p className='mt-2 line-clamp-2 text-[13px] leading-5 text-gray-600 dark:text-gray-300'>
            {item.intro}
          </p>
        )}
        <button
          type='button'
          onClick={play}
          className='pointer-events-auto mt-4 inline-flex h-10 items-center gap-1.5 rounded-full bg-brand-500 pl-4 pr-5 text-sm font-medium text-white shadow-lg shadow-brand-500/25 transition-transform active:scale-95'
        >
          <Play className='h-4 w-4 fill-current' />
          立即播放
        </button>
      </div>
    </div>
  );
}

function MobileHero({
  items,
  priority,
}: {
  items: HomeHeroItem[];
  priority: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [touching, setTouching] = useState(false);
  const count = items.length;

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setActiveIndex(Math.round(track.scrollLeft / track.clientWidth));
  };

  // 依赖 activeIndex：手动滑动后重新计时
  useEffect(() => {
    if (touching || count < 2) return;
    const timer = window.setTimeout(() => {
      const track = trackRef.current;
      if (!track || document.visibilityState !== 'visible') return;
      const next = (activeIndex + 1) % count;
      track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
    }, MOBILE_ROTATE_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, count, touching]);

  return (
    <section
      aria-roledescription='carousel'
      aria-label='精选'
      className='relative md:hidden'
    >
      <div
        ref={trackRef}
        onScroll={handleScroll}
        onTouchStart={() => setTouching(true)}
        onTouchEnd={() => setTouching(false)}
        onTouchCancel={() => setTouching(false)}
        className='scrollbar-hide flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain'
      >
        {items.map((item, index) => (
          <MobileHeroSlide
            key={item.id}
            item={item}
            priority={priority && index === 0}
          />
        ))}
      </div>
      {count > 1 && (
        <div
          aria-hidden='true'
          className='pointer-events-none absolute bottom-7 right-4 flex items-center gap-1.5'
        >
          {items.map((item, index) => (
            <span
              key={item.id}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                index === activeIndex
                  ? 'w-4 bg-brand-500 dark:bg-brand-400'
                  : 'w-1.5 bg-gray-900/20 dark:bg-white/30'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function HomeHero({
  items,
  likelyMobile,
}: {
  items: HomeHeroItem[];
  likelyMobile: boolean;
}) {
  const isMobile = useIsMobileViewport();
  if (items.length === 0) return null;

  // 视口未知（服务端与水合）时两套都输出由 CSS 断点切换，只按请求头推测给一套首图预加载；
  // 水合后只保留当前一套，隐藏侧的海报加载和轮播计时随之消失
  const mobileFirst = isMobile ?? likelyMobile;
  return (
    <>
      {isMobile !== true && (
        <DesktopHero items={items} priority={!mobileFirst} />
      )}
      {isMobile !== false && (
        <MobileHero items={items} priority={mobileFirst} />
      )}
    </>
  );
}

export function HomeHeroSkeleton() {
  return (
    <>
      <section aria-hidden='true' className='relative -mt-16 hidden md:block'>
        <div
          className={`${PAGE_CONTAINER_CLASS} flex h-[clamp(440px,58vh,560px)] items-end gap-10 pb-10 pt-24`}
        >
          <div className='skeleton aspect-[2/3] w-48 shrink-0 rounded-xl lg:w-56' />
          <div className='w-full max-w-2xl flex-1 pb-1'>
            <div className='skeleton h-3 w-10 rounded' />
            <div className='skeleton mt-3 h-11 w-2/3 rounded-lg lg:h-14' />
            <div className='skeleton mt-4 h-4 w-1/2 rounded' />
            <div className='mt-5 space-y-2.5'>
              <div className='skeleton h-4 w-full rounded' />
              <div className='skeleton h-4 w-11/12 rounded' />
              <div className='skeleton h-4 w-3/5 rounded' />
            </div>
            <div className='mt-8 flex gap-3'>
              <div className='skeleton h-11 w-32 rounded-full' />
              <div className='skeleton h-11 w-24 rounded-full' />
            </div>
          </div>
        </div>
      </section>
      <section
        aria-hidden='true'
        className={`skeleton-surface relative md:hidden ${MOBILE_HERO_HEIGHT_CLASS}`}
      >
        <div className='absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-gray-50 to-transparent dark:from-gray-950' />
        <div className='absolute inset-x-0 bottom-0 space-y-2.5 px-4 pb-4'>
          <div className='skeleton h-4 w-8 rounded' />
          <div className='skeleton h-8 w-2/3 rounded-lg' />
          <div className='skeleton h-3.5 w-1/2 rounded' />
          <div className='skeleton !mt-4 h-10 w-28 rounded-full' />
        </div>
      </section>
    </>
  );
}
