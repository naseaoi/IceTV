import { act, renderHook, waitFor } from '@testing-library/react';

import type {
  TrackingCalendarItem,
  TrackingStripSeed,
} from '@/features/continue-watching/lib/tracking-calendar';
import { fetchTrackingCalendar } from '@/features/continue-watching/lib/tracking-calendar-client';
import { writeContinueWatchingTrackingCount } from '@/lib/local-preferences';

import { useTrackingStrip } from './useTrackingStrip';

jest.mock('@/features/continue-watching/lib/tracking-calendar-client', () => ({
  fetchTrackingCalendar: jest.fn(),
}));
jest.mock('@/lib/local-preferences', () => ({
  writeContinueWatchingTrackingCount: jest.fn(),
}));
jest.mock('@/lib/db.client', () => ({
  subscribeToDataUpdates: (event: string, callback: () => void) => {
    window.addEventListener(event, callback);
    return () => window.removeEventListener(event, callback);
  },
}));

function item(key: string): TrackingCalendarItem {
  return {
    key,
    source: 'src',
    id: key,
    title: key,
    searchTitle: key,
    year: '2026',
    cover: '',
    origin: 'record',
    episodeIndex: 1,
    totalEpisodes: 12,
    hasUpdate: true,
    updateDetectedAt: 1,
    airWeekday: null,
  };
}

function seed(patch: Partial<TrackingStripSeed> = {}): TrackingStripSeed {
  return {
    items: [item('a')],
    complete: true,
    fetchedAt: Date.now(),
    ...patch,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchTrackingCalendar).mockResolvedValue([item('fresh')]);
});

it('刚完成的完整种子直接复用，不重复请求，并写入计数', () => {
  const value = seed();
  const { result } = renderHook(() => useTrackingStrip(value));
  expect(result.current.map((entry) => entry.key)).toEqual(['a']);
  expect(fetchTrackingCalendar).not.toHaveBeenCalled();
  expect(writeContinueWatchingTrackingCount).toHaveBeenCalledWith(1);
});

it.each([
  ['日历未完成', { complete: false }],
  ['后退恢复的旧种子', { fetchedAt: Date.now() - 60_000 }],
  ['服务端未查询', { fetchedAt: 0 }],
])('%s时挂载后重新验证', async (_, patch) => {
  const value = seed(patch);
  const { result } = renderHook(() => useTrackingStrip(value));
  await waitFor(() =>
    expect(result.current.map((entry) => entry.key)).toEqual(['fresh']),
  );
  expect(fetchTrackingCalendar).toHaveBeenCalledTimes(1);
});

it('写入完成事件与状态更新事件触发刷新', async () => {
  const value = seed();
  const { result } = renderHook(() => useTrackingStrip(value));
  act(() => {
    window.dispatchEvent(new Event('userLibraryUpdated'));
  });
  await waitFor(() =>
    expect(result.current.map((entry) => entry.key)).toEqual(['fresh']),
  );
  act(() => {
    window.dispatchEvent(new CustomEvent('playRecordStatesUpdated'));
  });
  expect(fetchTrackingCalendar).toHaveBeenCalledTimes(2);
});

it('连续刷新时取消旧请求，卸载后不再监听', () => {
  const signals: AbortSignal[] = [];
  jest.mocked(fetchTrackingCalendar).mockImplementation((signal) => {
    if (signal) signals.push(signal);
    return new Promise(() => {});
  });
  const value = seed();
  const { unmount } = renderHook(() => useTrackingStrip(value));
  act(() => {
    window.dispatchEvent(new Event('userLibraryUpdated'));
    window.dispatchEvent(new Event('userLibraryUpdated'));
  });
  expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
  unmount();
  expect(signals[1].aborted).toBe(true);
  window.dispatchEvent(new Event('userLibraryUpdated'));
  expect(fetchTrackingCalendar).toHaveBeenCalledTimes(2);
});

it('服务端给出新种子时以新种子为准', () => {
  const { result, rerender } = renderHook(
    ({ value }) => useTrackingStrip(value),
    { initialProps: { value: seed() } },
  );
  rerender({
    value: seed({ items: [item('b'), item('c')], fetchedAt: Date.now() + 1 }),
  });
  expect(result.current.map((entry) => entry.key)).toEqual(['b', 'c']);
});
