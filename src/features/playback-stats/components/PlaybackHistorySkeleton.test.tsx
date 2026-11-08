import { render } from '@testing-library/react';

import { PlaybackHistoryGridSkeleton } from '@/features/playback-stats/components/PlaybackHistoryLibrary';
import { PlaybackHistoryPreviewSkeleton } from '@/features/playback-stats/components/PlaybackHistoryPreview';
import { usePlaybackHistoryPlaceholder } from '@/features/playback-stats/hooks/usePlaybackHistory';
import type { PlaybackSession } from '@/lib/types';

jest.mock('@/features/playback-stats/hooks/usePlaybackHistory', () => ({
  usePlaybackHistoryPlaceholder: jest.fn(),
  usePlaybackHistory: jest.fn(),
  usePlayHistorySession: jest.fn(),
}));
jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const sessions = Array.from({ length: 6 }, (_, index) => ({
  id: String(index),
  started_at: Date.now() - (index < 2 ? 0 : 86400000),
})) as PlaybackSession[];

it('历史列表按已有缓存的日期分区和六条数量占位', () => {
  jest.mocked(usePlaybackHistoryPlaceholder).mockReturnValue({
    count: 10,
    snapshot: { items: sessions, nextCursor: null },
  });
  const { container } = render(<PlaybackHistoryGridSkeleton />);
  expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(6);
  expect(container.querySelectorAll('.grid')).toHaveLength(2);
});

it('预览数量按请求页大小限制缓存，空缓存保留空态高度', () => {
  jest.mocked(usePlaybackHistoryPlaceholder).mockReturnValue({
    count: 3,
    snapshot: { items: sessions, nextCursor: null },
  });
  const { container, rerender } = render(<PlaybackHistoryPreviewSkeleton />);
  expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(3);
  jest
    .mocked(usePlaybackHistoryPlaceholder)
    .mockReturnValue({ count: 10, snapshot: { items: [], nextCursor: null } });
  rerender(<PlaybackHistoryPreviewSkeleton />);
  expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(0);
  expect(container.firstElementChild).toHaveClass('h-[68px]');
});

it('未知数量采用实际请求页大小，而不是固定十二个', () => {
  jest
    .mocked(usePlaybackHistoryPlaceholder)
    .mockReturnValue({ count: 7, snapshot: null });
  const { container } = render(<PlaybackHistoryGridSkeleton />);
  expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(7);
});
