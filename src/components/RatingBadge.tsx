import { Star } from 'lucide-react';

import { POSTER_BADGE_CLASS } from '@/components/poster-card-layout';
import { formatRating } from '@/lib/rating';

interface RatingBadgeProps {
  value: number;
  // soft 用于普通背景，overlay 用于压在封面图上
  variant?: 'soft' | 'overlay';
  // 读屏前缀，如「我的评分」
  label?: string;
  className?: string;
}

const VARIANT_CLASS = {
  soft: 'rounded-md px-1.5 py-0.5 text-xs leading-none bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300',
  overlay: `${POSTER_BADGE_CLASS} bg-black/70 text-amber-300`,
} as const;

export default function RatingBadge({
  value,
  variant = 'soft',
  label,
  className = '',
}: RatingBadgeProps) {
  return (
    <span
      role='img'
      aria-label={`${label ? `${label} ` : ''}${formatRating(value)} 分`}
      className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${VARIANT_CLASS[variant]} ${className}`}
    >
      <Star aria-hidden='true' className='h-3 w-3' fill='currentColor' />
      {formatRating(value)}
    </span>
  );
}
