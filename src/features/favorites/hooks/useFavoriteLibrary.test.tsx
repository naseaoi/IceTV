import { act, renderHook, waitFor } from '@testing-library/react';

import { useFavoriteLibrary } from '@/features/favorites/hooks/useFavoriteLibrary';
import type { FavoriteLibraryPage } from '@/features/favorites/lib/library-query';
import { VIDEO_REVIEWS_UPDATED_EVENT } from '@/lib/video-reviews';

const mockFetch = jest.fn();
const mockWriteCount = jest.fn();
const mockListeners = new Map<string, () => void>();
jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({
    session: { status: 'authenticated', profileId: 'me' },
  }),
}));
jest.mock('@/lib/db.client.internal', () => ({
  fetchWithAuth: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/lib/db.client', () => ({
  clearAllFavorites: jest.fn().mockResolvedValue(undefined),
  subscribeToDataUpdates: (event: string, callback: () => void) => {
    mockListeners.set(event, callback);
    return () => mockListeners.delete(event);
  },
}));
jest.mock('@/lib/local-preferences', () => ({
  readFavoriteItemsCount: () => 100,
  writeFavoriteItemsCount: (...args: unknown[]) => mockWriteCount(...args),
}));

const page = (
  id: string,
  nextCursor: string | null = null,
): FavoriteLibraryPage => ({
  items: [
    {
      key: `source+${id}`,
      favorite: {
        title: id,
        year: '2026',
        source_name: 'source',
        cover: '',
        total_episodes: 2,
        save_time: 1,
      },
      myRating: 8,
      watchStatus: 'planned',
      watchStatusManual: false,
      watchedAt: null,
    },
  ],
  counts: { all: 100, planned: 100, watching: 0, completed: 0, reviewed: 0 },
  total: 100,
  libraryTotal: 100,
  nextCursor,
});
const response = (value: FavoriteLibraryPage) => ({
  ok: true,
  json: async () => value,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
});

it('requests only library pages, appends with one in-flight load, and preserves server totals/count skeletons', async () => {
  mockFetch
    .mockResolvedValueOnce(response(page('1', 'cursor')))
    .mockResolvedValueOnce(response(page('2')));
  const { result } = renderHook(() => useFavoriteLibrary(20));
  expect(result.current.skeletonCount).toBe(48);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items[0].myRating).toBe(8);
  expect(result.current.total).toBe(100);
  act(() => {
    result.current.loadMore();
    result.current.loadMore();
  });
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(
    mockFetch.mock.calls.every(([url]) =>
      url.startsWith('/api/favorites?format=library'),
    ),
  ).toBe(true);
  expect(mockFetch.mock.calls[1][0]).toContain('cursor=cursor');
  expect(mockWriteCount).toHaveBeenLastCalledWith(100);
});

it('debounces input, aborts old loads and rejects late results after conditions change', async () => {
  let resolveOld!: (value: ReturnType<typeof response>) => void;
  mockFetch
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValue(response(page('new')));
  const { result, rerender } = renderHook(
    ({ query, sort }: { query: string; sort: 'saved' | 'rating' }) =>
      useFavoriteLibrary(0, { query, filter: 'all', sort }),
    { initialProps: { query: '', sort: 'saved' } },
  );
  const oldSignal = mockFetch.mock.calls[0][1].signal;
  rerender({ query: 'd', sort: 'saved' });
  rerender({ query: 'demo', sort: 'saved' });
  expect(oldSignal.aborted).toBe(true);
  await waitFor(() => expect(result.current.items[0]?.title).toBe('new'));
  await act(async () => resolveOld(response(page('old'))));
  expect(result.current.items[0].title).toBe('new');
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(mockFetch.mock.calls[1][0]).toContain('q=demo');
  rerender({ query: 'demo', sort: 'rating' });
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
  expect(mockFetch.mock.calls[2][0]).not.toContain('cursor=');
});

it('invalidates on favorite, playback and review updates and exposes recoverable errors', async () => {
  mockFetch.mockResolvedValue(response(page('1')));
  const { result } = renderHook(() => useFavoriteLibrary());
  await waitFor(() => expect(result.current.loading).toBe(false));
  for (const event of ['favoritesUpdated', 'playRecordsUpdated']) {
    const calls = mockFetch.mock.calls.length;
    act(() => mockListeners.get(event)?.());
    await waitFor(() => expect(mockFetch.mock.calls.length).toBe(calls + 1));
  }
  mockFetch.mockRejectedValueOnce(new Error('network failure'));
  act(() => window.dispatchEvent(new Event(VIDEO_REVIEWS_UPDATED_EVENT)));
  await waitFor(() => expect(result.current.error).toBe('network failure'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.error).toBeNull());
});

it('keeps current results while switching filters and reuses first-page snapshots', async () => {
  let resolveReviewed!: (value: ReturnType<typeof response>) => void;
  mockFetch
    .mockResolvedValueOnce(response(page('all')))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReviewed = resolve;
        }),
    )
    .mockImplementationOnce(() => new Promise(() => {}));
  const { result, rerender } = renderHook(
    ({ filter }: { filter: 'all' | 'reviewed' }) =>
      useFavoriteLibrary(0, { query: '', filter, sort: 'saved' }),
    { initialProps: { filter: 'all' } },
  );
  await waitFor(() => expect(result.current.loading).toBe(false));

  rerender({ filter: 'reviewed' });
  expect(result.current.loading).toBe(false);
  expect(result.current.refreshing).toBe(true);
  expect(result.current.items[0].title).toBe('all');
  await act(async () => resolveReviewed(response(page('reviewed'))));
  expect(result.current.refreshing).toBe(false);
  expect(result.current.items[0].title).toBe('reviewed');

  rerender({ filter: 'all' });
  expect(result.current.items[0].title).toBe('all');
  expect(result.current.refreshing).toBe(true);
});
