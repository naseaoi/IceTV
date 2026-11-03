import { Star } from 'lucide-react';

import { formatRating } from '@/lib/rating';

export interface RatingStarsProps {
  value: number | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  // 嵌在可交互控件内时由外层提供语义
  decorative?: boolean;
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
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} aria-hidden='true' className='relative inline-flex'>
          <Star
            className={`${starClassName} text-gray-300 dark:text-gray-600`}
          />
          <span
            className='absolute left-0 top-0 overflow-hidden text-amber-500 dark:text-amber-400'
            style={{
              width: `${Math.max(0, Math.min(1, fillValue / 2 - index)) * 100}%`,
            }}
          >
            <Star className={starClassName} fill='currentColor' />
          </span>
        </span>
      ))}
    </span>
  );
}
