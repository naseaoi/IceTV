import { act, renderHook, waitFor } from '@testing-library/react';

import { usePlaybackHistory } from '@/features/playback-stats/hooks/usePlaybackHistory';
import {
  deletePlaybackHistoryItem,
  getPlaybackHistory,
} from '@/features/playback-stats/lib/client';
import { showToast } from '@/lib/toast';
import type { WatchHistoryEntry } from '@/lib/types';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('@/components/RuntimeConfigProvider', () => ({
  useRuntimeConfig: () => ({}),
}));
jest.mock('@/features/playback-stats/lib/client', () => ({
  cachePlaybackHistorySnapshot: jest.fn(),
  deletePlaybackHistoryItem: jest.fn(),
  getCachedPlaybackHistorySnapshot: jest.fn().mockReturnValue(null),
  getPlaybackHistory: jest.fn(),
}));

const items: WatchHistoryEntry[] = ['history1', 'history2'].map((id) => ({
  id,
  source: 'src',
  video_id: id,
  title: id,
  source_name: '源站',
  cover: '',
  year: '2026',
  episode_index: 1,
  total_episodes: 12,
  position: 1,
  duration: 60,
  first_watched_at: 1,
  last_watched_at: 2,
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest
    .mocked(getPlaybackHistory)
    .mockResolvedValue({ items, nextCursor: null });
  jest
    .mocked(deletePlaybackHistoryItem)
    .mockReset()
    .mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it.each([1, 2])('删除 %s 条全部失败时仅提示一次并保留记录', async (count) => {
  jest.mocked(deletePlaybackHistoryItem).mockRejectedValue(new Error('failed'));
  const { result } = renderHook(() => usePlaybackHistory());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    expect(
      await result.current.removeEntries(
        items.slice(0, count).map(({ id }) => id),
      ),
    ).toBe(0);
  });
  expect(result.current.items).toEqual(items);
  expect(showToast).toHaveBeenCalledTimes(1);
  expect(showToast).toHaveBeenCalledWith('删除失败，请重试', 'error');
});

it('部分失败时仅移除成功项并报告成功与失败数量', async () => {
  jest
    .mocked(deletePlaybackHistoryItem)
    .mockRejectedValueOnce(new Error('failed'));
  const { result } = renderHook(() => usePlaybackHistory());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    expect(await result.current.removeEntries(items.map(({ id }) => id))).toBe(
      1,
    );
  });
  expect(result.current.items).toEqual([items[0]]);
  expect(showToast).toHaveBeenCalledTimes(1);
  expect(showToast).toHaveBeenCalledWith(
    '已删除 1 条，1 条删除失败，请重试',
    'error',
  );
});

it('全部成功或空选择保持静默', async () => {
  const { result } = renderHook(() => usePlaybackHistory());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    expect(await result.current.removeEntries([])).toBe(0);
    expect(await result.current.removeEntries(items.map(({ id }) => id))).toBe(
      2,
    );
  });
  expect(result.current.items).toEqual([]);
  expect(showToast).not.toHaveBeenCalled();
});
