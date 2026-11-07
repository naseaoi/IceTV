import { Star } from 'lucide-react';
import type { CSSProperties } from 'react';

import { formatRating } from '@/lib/rating';

export interface RatingStarsProps {
  value: number | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  // 嵌在可交互控件内时由外层提供语义
  decorative?: boolean;
  // 用户改分后的反馈：from / to 为改分前后点亮（含半颗）的星数，id 变化时重播
  pop?: RatingStarsPop | null;
}

export interface RatingStarsPop {
  id: number;
  from: number;
  to: number;
}

export function litStarCount(value: number | null) {
  return value === null ? 0 : Math.ceil(value / 2);
}

function starMotion(index: number, pop: RatingStarsPop | null | undefined) {
  if (!pop) return null;
  const { from, to } = pop;
  if (to > from) {
    if (index < from || index >= to) return null;
    return {
      className: 'rating-star-pop',
      last: index === to - 1,
      order: index - from,
    };
  }
  if (to < from) {
    return index >= to && index < from
      ? { className: 'rating-star-dip', last: false, order: 0 }
      : null;
  }
  // 点亮星数不变（如 7.0 → 7.5），只让落点那颗回应
  return index === to - 1
    ? { className: 'rating-star-pop', last: false, order: 0 }
    : null;
}

const STAR_SIZE_CLASS = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-7 w-7',
} as const;

export default function RatingStars({
  value,
  size = 'md',
  className = '',
  decorative = false,
  pop,
}: RatingStarsProps) {
  if (value === null && !decorative) {
    return (
      <span className={`text-sm text-gray-500 dark:text-gray-400 ${className}`}>
        未评分
      </span>
    );
  }

  const starClassName = STAR_SIZE_CLASS[size];
  const fillValue = value ?? 0;

  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={
        decorative ? undefined : `${formatRating(fillValue)} 分（满分 10 分）`
      }
      className={`inline-flex items-center ${size === 'lg' ? 'gap-1' : 'gap-0.5'} ${className}`}
    >
      {Array.from({ length: 5 }, (_, index) => {
        const motion = starMotion(index, pop);
        return (
          <span
            key={motion ? `${index}-${pop?.id}` : index}
            aria-hidden='true'
            data-last={motion?.last || undefined}
            className={`relative inline-flex ${motion?.className ?? ''}`}
            style={
              motion
                ? ({ '--star-index': motion.order } as CSSProperties)
                : undefined
            }
          >
            <Star
              className={`${starClassName} text-gray-300 dark:text-gray-600`}
            />
            <span
              className='absolute left-0 top-0 overflow-hidden text-amber-500 transition-[width] duration-150 ease-out dark:text-amber-400'
              style={{
                width: `${Math.max(0, Math.min(1, fillValue / 2 - index)) * 100}%`,
              }}
            >
              <Star className={starClassName} fill='currentColor' />
            </span>
          </span>
        );
      })}
    </span>
  );
}
