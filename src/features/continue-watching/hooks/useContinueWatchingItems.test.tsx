import { act, renderHook, waitFor } from '@testing-library/react';

import { useContinueWatchingItems } from '@/features/continue-watching/hooks/useContinueWatchingItems';
import { CONTINUE_WATCHING_PAGE_SIZE } from '@/features/continue-watching/lib/layout';
import {
  getCachedPlayRecordsSnapshot,
  getPlayRecordPage,
} from '@/lib/db.client';
import { writeContinueWatchingPageCount } from '@/lib/local-preferences';
import type { PlayRecord } from '@/lib/types';

jest.mock('@/lib/db.client', () => ({
  clearAllPlayRecords: jest.fn(),
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
    const { result } = renderHook(() => useContinueWatchingItems(24));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(writeContinueWatchingPageCount).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
