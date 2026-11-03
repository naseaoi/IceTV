import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import { DOUBAN_GRID_CLASS } from '@/features/douban/lib/grid-layout';

const SKELETON_COUNT = 18;

export function DoubanFeedLoading() {
  return (
    <div
      data-douban-feed-loading
      className={DOUBAN_GRID_CLASS}
      role='status'
      aria-label='正在加载'
    >
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <DoubanCardSkeleton key={index} />
      ))}
    </div>
  );
}
