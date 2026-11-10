import { act, renderHook, waitFor } from '@testing-library/react';

import { useContinueWatchingItems } from '@/features/continue-watching/hooks/useContinueWatchingItems';
import { CONTINUE_WATCHING_PAGE_SIZE } from '@/features/continue-watching/lib/layout';
import {
  clearAllPlayRecords,
  deletePlayRecords,
  getCachedPlayRecordsSnapshot,
  getPlayRecordPage,
} from '@/lib/db.client';
import { writeContinueWatchingPageCount } from '@/lib/local-preferences';
import type { PlayRecord } from '@/lib/types';

jest.mock('@/lib/db.client', () => ({
  clearAllPlayRecords: jest.fn(),
  deletePlayRecords: jest.fn(),
  getCachedPlayRecordsSnapshot: jest.fn(),
  getPlayRecordPage: jest.fn(),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));
jest.mock('@/lib/local-preferences', () => ({
  writeContinueWatchingPageCount: jest.fn(),
}));

describe('useContinueWatchingItems loading geometry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCachedPlayRecordsSnapshot as jest.Mock).mockReturnValue(null);
  });

  it('starts loading with an unknown count and persists the actual first page count', async () => {
    let resolve!: (value: unknown) => void;
    (getPlayRecordPage as jest.Mock).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() => useContinueWatchingItems());
    expect(result.current.loading).toBe(true);
    expect(writeContinueWatchingPageCount).not.toHaveBeenCalled();
    const record = { title: 'movie', save_time: 1 } as PlayRecord;
    await act(async () =>
      resolve({ items: { 'source+id': record }, total: 1, nextCursor: null }),
    );
    expect(result.current.loading).toBe(false);
    expect(getPlayRecordPage).toHaveBeenCalledWith(CONTINUE_WATCHING_PAGE_SIZE);
    expect(writeContinueWatchingPageCount).toHaveBeenLastCalledWith(1);
  });

  it('preserves the last successful count when the request fails', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation();
    (getPlayRecordPage as jest.Mock).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() =>
      useContinueWatchingItems({ initialSkeletonCount: 24 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(writeContinueWatchingPageCount).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it.each(['updated', 'shelved'] as const)(
    'requests only %s records and keeps the page count cookie untouched',
    async (filter) => {
      const record = { title: 'show', save_time: 1 } as PlayRecord;
      (getPlayRecordPage as jest.Mock).mockResolvedValue({
        items: { 'source+id': record },
        total: 1,
        nextCursor: null,
      });
      const { result } = renderHook(() => useContinueWatchingItems({ filter }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(getPlayRecordPage).toHaveBeenCalledWith(
        CONTINUE_WATCHING_PAGE_SIZE,
        null,
        { filter },
      );
      expect(result.current.counts[filter]).toBe(1);
      expect(writeContinueWatchingPageCount).not.toHaveBeenCalled();
    },
  );

  it('clears everything in one request only when every record is selected', async () => {
    const records = {
      'a+1': { title: 'a', save_time: 2 } as PlayRecord,
      'b+2': { title: 'b', save_time: 1 } as PlayRecord,
    };
    (getPlayRecordPage as jest.Mock).mockResolvedValue({
      items: records,
      total: 2,
      nextCursor: null,
    });
    const { result } = renderHook(() => useContinueWatchingItems());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(() => result.current.removeItems(['a+1']));
    expect(deletePlayRecords).toHaveBeenCalledWith(['a+1']);
    expect(clearAllPlayRecords).not.toHaveBeenCalled();
    expect(result.current.items.map((item) => item.key)).toEqual(['b+2']);
    expect(result.current.counts.all).toBe(1);

    await act(() => result.current.removeItems(['b+2']));
    expect(clearAllPlayRecords).toHaveBeenCalledTimes(1);
    expect(result.current.items).toHaveLength(0);
  });
});

it('读取失败可重试，续页失败保留记录与游标', async () => {
  jest.mocked(getCachedPlayRecordsSnapshot).mockReturnValue(null);
  jest.mocked(getPlayRecordPage).mockRejectedValueOnce(new Error('failed'));
  const { result } = renderHook(() => useContinueWatchingItems());
  await waitFor(() => expect(result.current.error).toBeTruthy());
  const record = { title: '作品', save_time: 1 } as PlayRecord;
  jest.mocked(getPlayRecordPage).mockResolvedValueOnce({
    items: { 'src+1': record },
    total: 2,
    nextCursor: 'next',
  });
  await act(async () => result.current.retry());
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  jest.mocked(getPlayRecordPage).mockRejectedValueOnce(new Error('failed'));
  await act(async () => result.current.loadMore());
  expect(result.current.items).toHaveLength(1);
  expect(result.current.hasMore).toBe(true);
  jest
    .mocked(getPlayRecordPage)
    .mockResolvedValueOnce({ items: {}, total: 2, nextCursor: null });
  await act(async () => result.current.retry());
  expect(getPlayRecordPage).toHaveBeenLastCalledWith(
    CONTINUE_WATCHING_PAGE_SIZE,
    'next',
    undefined,
  );
  expect(result.current.error).toBeNull();
});
