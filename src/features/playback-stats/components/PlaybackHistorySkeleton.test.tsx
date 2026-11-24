import { render } from '@testing-library/react';

import { PlaybackHistoryGridSkeleton } from '@/features/playback-stats/components/PlaybackHistoryLibrary';
import { PlaybackHistoryPreviewSkeleton } from '@/features/playback-stats/components/PlaybackHistoryPreview';
import { usePlaybackHistoryPlaceholder } from '@/features/playback-stats/hooks/usePlaybackHistory';
import type { WatchHistoryEntry } from '@/lib/types';

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
  last_watched_at: Date.now() - (index < 2 ? 0 : 86400000),
})) as WatchHistoryEntry[];

it('历史列表按已有缓存的日期分区和六条数量占位', () => {
  jest.mocked(usePlaybackHistoryPlaceholder).mockReturnValue({
    count: 10,
    snapshot: { items: sessions, nextCursor: null },
  });
  const { container } = render(<PlaybackHistoryGridSkeleton />);
  expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(6);
  expect(container.querySelectorAll('.grid')).toHaveLength(2);
});

it('预览按已知条数占位，已知为空时占住整排且不提前显示空状态文案', () => {
  jest.mocked(usePlaybackHistoryPlaceholder).mockReturnValue({
    count: 3,
    snapshot: { items: sessions, nextCursor: null },
  });
  const { container, rerender } = render(<PlaybackHistoryPreviewSkeleton />);
  expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(3);
  jest
    .mocked(usePlaybackHistoryPlaceholder)
    .mockReturnValue({ count: 0, snapshot: { items: [], nextCursor: null } });
  rerender(<PlaybackHistoryPreviewSkeleton />);
  expect(container.querySelectorAll('.border-dashed')).not.toHaveLength(0);
  expect(
    container.querySelectorAll('.skeleton.aspect-\\[2\\/3\\]'),
  ).toHaveLength(0);
  expect(container).not.toHaveTextContent('还没有观看记录');
});

it('无快照时按计数占位', () => {
  jest
    .mocked(usePlaybackHistoryPlaceholder)
    .mockReturnValue({ count: 7, snapshot: null });
  const { container } = render(<PlaybackHistoryGridSkeleton />);
  expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(7);
});
