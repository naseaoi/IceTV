import {
  HOME_POSTER_CARD_CLASS,
  POSTER_CARD_COVER_CLASS,
  POSTER_CARD_FIXED_TITLE_ROW_CLASS,
  POSTER_CARD_SUBTITLE_ROW_CLASS,
  POSTER_CARD_TITLE_ROW_CLASS,
} from '@/components/poster-card-layout';
import SkeletonText from '@/components/SkeletonText';

// 覆盖 1680px 容器内的首屏与右侧露出的下一张，和真实横排共用挂载批量。
export const HOME_RECOMMENDATION_INITIAL_COUNT = 10;

interface HomePosterCardSkeletonProps {
  className?: string;
  subtitle?: boolean;
  // poster 对应 PosterCard 的固定标题行，video 对应 VideoCard 等自然行高
  variant?: 'poster' | 'video';
}

export default function HomePosterCardSkeleton({
  className = HOME_POSTER_CARD_CLASS,
  subtitle = false,
  variant = 'video',
}: HomePosterCardSkeletonProps) {
  return (
    <div className={className}>
      <div className='group relative w-full rounded-lg bg-transparent'>
        <div
          className={`skeleton relative overflow-hidden ${POSTER_CARD_COVER_CLASS}`}
        />
        <SkeletonText
          className={
            variant === 'poster' && !subtitle
              ? POSTER_CARD_FIXED_TITLE_ROW_CLASS
              : POSTER_CARD_TITLE_ROW_CLASS
          }
        />
        {subtitle && (
          <SkeletonText
            className={POSTER_CARD_SUBTITLE_ROW_CLASS}
            barClassName='h-3 w-1/2 rounded'
          />
        )}
      </div>
    </div>
  );
}
