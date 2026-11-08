import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import {
  DOUBAN_GRID_CLASS,
  DOUBAN_PAGE_SIZE,
} from '@/features/douban/lib/grid-layout';

export function DoubanFeedLoading() {
  return (
    <div
      data-douban-feed-loading
      className={DOUBAN_GRID_CLASS}
      role='status'
      aria-label='正在加载'
    >
      {Array.from({ length: DOUBAN_PAGE_SIZE }, (_, index) => (
        <DoubanCardSkeleton key={index} />
      ))}
    </div>
  );
}
