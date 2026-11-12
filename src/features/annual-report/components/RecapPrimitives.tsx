'use client';

import {
  type CSSProperties,
  type ElementType,
  type ReactNode,
  useEffect,
  useState,
} from 'react';

import CoverImage from '@/components/CoverImage';

// 文字层级：主文、次要说明、弱化标注、强调
export const RECAP_TEXT = {
  primary: 'text-gray-900 dark:text-gray-50',
  secondary: 'text-gray-500 dark:text-gray-400',
  muted: 'text-gray-400 dark:text-gray-500',
  accent: 'text-brand-600 dark:text-brand-300',
} as const;

// 细分隔线
export const RECAP_RULE = 'border-gray-900/[0.08] dark:border-white/[0.08]';

export const RECAP_BUTTON = {
  primary:
    'inline-flex h-10 items-center gap-1.5 rounded-full bg-gray-900 px-5 text-sm font-medium text-white transition hover:bg-gray-800 active:scale-[0.97] dark:bg-gray-50 dark:text-gray-900 dark:hover:bg-white',
  secondary:
    'inline-flex h-10 items-center rounded-full px-5 text-sm font-medium text-gray-700 ring-1 ring-gray-900/10 transition hover:bg-gray-900/[0.04] active:scale-[0.97] dark:text-gray-200 dark:ring-white/15 dark:hover:bg-white/[0.06]',
} as const;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function Rise({
  d = 0,
  as: Tag = 'div',
  className = '',
  children,
}: {
  d?: number;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={`recap-rise ${className}`}
      style={{ '--d': d } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

export function useCountUp(target: number, delay = 360, duration = 1600) {
  const [value, setValue] = useState(() =>
    prefersReducedMotion() ? target : 0,
  );
  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    let frame = 0;
    let startAt = 0;
    const tick = (now: number) => {
      if (!startAt) startAt = now + delay;
      const progress = Math.min(1, Math.max(0, (now - startAt) / duration));
      // easeOutExpo：前段快速爬升，末尾缓慢落定
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(target * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [delay, duration, target]);
  return value;
}

export function CountUp({
  value,
  delay,
  duration,
}: {
  value: number;
  delay?: number;
  duration?: number;
}) {
  const current = useCountUp(value, delay, duration);
  return <span>{Math.round(current).toLocaleString('zh-CN')}</span>;
}

export function RecapCover({
  cover,
  title,
  className = '',
  sizes = '160px',
  priority = false,
}: {
  cover: string;
  title: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <div
      className={`relative aspect-[2/3] shrink-0 overflow-hidden bg-gray-200 ring-1 ring-gray-900/[0.06] dark:bg-gray-800 dark:ring-white/[0.08] ${className}`}
    >
      <CoverImage src={cover} alt={title} sizes={sizes} priority={priority} />
    </div>
  );
}

// 低饱和色调（RGB），每页一种，只用于背景晕染与少量点缀
export const RECAP_TINTS = {
  ice: '61 141 198',
  frost: '86 160 182',
  mist: '118 128 172',
  night: '88 96 168',
  dusk: '172 124 146',
  sand: '190 154 102',
  sage: '104 156 136',
} as const;

export type RecapTint = keyof typeof RECAP_TINTS;

const TINT_POSITIONS = {
  'top-right': ['88%', '0%'],
  'top-left': ['12%', '0%'],
  'bottom-right': ['88%', '100%'],
} as const;

export function RecapBackdrop({
  tint,
  at = 'top-right',
}: {
  tint: RecapTint;
  at?: keyof typeof TINT_POSITIONS;
}) {
  const [x, y] = TINT_POSITIONS[at];
  return (
    <div
      aria-hidden
      className='recap-backdrop recap-fade absolute inset-0 overflow-hidden'
      style={
        {
          '--tint': RECAP_TINTS[tint],
          '--tint-x': x,
          '--tint-y': y,
        } as CSSProperties
      }
    >
      <svg
        className={`absolute h-[130%] w-[130%] text-gray-900/[0.05] dark:text-white/[0.05] ${at === 'bottom-right' ? '-bottom-[65%] -right-[65%]' : at === 'top-left' ? '-left-[65%] -top-[65%]' : '-right-[65%] -top-[65%]'}`}
        viewBox='0 0 100 100'
        fill='none'
      >
        <circle
          cx='50'
          cy='50'
          r='34'
          stroke='currentColor'
          strokeWidth='0.15'
        />
        <circle
          cx='50'
          cy='50'
          r='46'
          stroke='currentColor'
          strokeWidth='0.15'
        />
      </svg>
    </div>
  );
}

// 幻灯片内容区：上方给标题栏、下方给翻页提示留位，内容过高时在区内滚动
export function SlideBody({
  children,
  center = false,
  className = '',
}: {
  children: ReactNode;
  center?: boolean;
  className?: string;
}) {
  // safe 居中：横屏等矮视口内容超高时从顶部排起，避免顶部被裁且无法滚回
  // 横向内边距随宽度增长，宽视口里内容仍保持竖版宽度，滚动区域铺满便于触摸
  return (
    <div
      className={`recap-scroll relative flex h-full flex-col overflow-y-auto overscroll-contain px-[max(2rem,calc(50%-14rem))] pb-24 pt-[calc(env(safe-area-inset-top)+5.5rem)] sm:px-[max(2.5rem,calc(50%-14rem))] ${RECAP_TEXT.primary} ${center ? '[justify-content:safe_center]' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

// 页眉标注：英文小字加短线，只作装饰
export function Kicker({
  d = 0,
  className = '',
  children,
}: {
  d?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Rise
      d={d}
      className={`flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.22em] ${RECAP_TEXT.muted} ${className}`}
    >
      <span aria-hidden className='h-px w-6 bg-current' />
      {children}
    </Rise>
  );
}

export function Lead({
  d = 0,
  className = '',
  children,
}: {
  d?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Rise
      d={d}
      className={`text-[15px] leading-relaxed ${RECAP_TEXT.secondary} ${className}`}
    >
      {children}
    </Rise>
  );
}

export function Headline({
  d = 0,
  children,
  className = '',
}: {
  d?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Rise
      d={d}
      as='h2'
      className={`text-[26px] font-medium leading-[1.35] tracking-tight ${className}`}
    >
      {children}
    </Rise>
  );
}

// 大号数字：细字重，单位与数字基线对齐
export function Figure({
  value,
  unit,
  size = 'lg',
  delay,
}: {
  value: number;
  unit?: string;
  size?: 'lg' | 'md' | 'sm';
  delay?: number;
}) {
  const sizeClass =
    size === 'lg'
      ? 'text-[96px] tracking-[-0.04em]'
      : size === 'md'
        ? 'text-[56px] tracking-[-0.03em]'
        : 'text-[30px] tracking-[-0.02em]';
  return (
    <span className='inline-flex items-baseline gap-1.5'>
      <span className={`font-extralight leading-none ${sizeClass}`}>
        <CountUp value={value} delay={delay} />
      </span>
      {unit && (
        <span
          className={`${size === 'sm' ? 'text-xs' : 'text-base'} ${RECAP_TEXT.secondary}`}
        >
          {unit}
        </span>
      )}
    </span>
  );
}
