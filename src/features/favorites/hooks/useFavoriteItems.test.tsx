import { act, renderHook, waitFor } from '@testing-library/react';

import { useFavoriteItems } from '@/features/favorites/hooks/useFavoriteItems';
import type { FavoriteLibraryPage } from '@/features/favorites/lib/library-query';

const mockFetch = jest.fn();
const mockWriteCount = jest.fn();
const mockListeners = new Map<string, () => void>();
jest.mock('@/lib/db.client.internal', () => ({
  fetchWithAuth: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/lib/db.client', () => ({
  getCachedFavoritesSnapshot: () => null,
  getCachedPlayRecordsSnapshot: () => null,
  subscribeToDataUpdates: (event: string, callback: () => void) => {
    mockListeners.set(event, callback);
    return () => mockListeners.delete(event);
  },
}));
jest.mock('@/lib/local-preferences', () => ({
  readFavoriteItemsCount: () => 3,
  writeFavoriteItemsCount: (...args: unknown[]) => mockWriteCount(...args),
}));

const page = (libraryTotal: number): FavoriteLibraryPage => ({
  items: [
    {
      key: 'source+1',
      favorite: {
        title: '甲',
        year: '2026',
        source_name: 'source',
        cover: '',
        total_episodes: 2,
        save_time: 1,
      },
      myRating: null,
      watchStatus: 'planned',
      watchStatusManual: false,
      watchedAt: null,
    },
  ],
  counts: {
    all: libraryTotal,
    planned: libraryTotal,
    watching: 0,
    completed: 0,
    reviewed: 0,
  },
  total: libraryTotal,
  libraryTotal,
  nextCursor: null,
});
const response = (value: FavoriteLibraryPage) => ({
  ok: true,
  json: async () => value,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
});

it('收藏栏走收藏库查询，总数与计数都取 libraryTotal', async () => {
  mockFetch.mockResolvedValue(response(page(30)));
  const { result } = renderHook(() => useFavoriteItems(0));
  expect(result.current.skeletonCount).toBe(3);
  await waitFor(() => expect(result.current.loading).toBe(false));

  const url = new URL(mockFetch.mock.calls[0][0], 'http://localhost');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    format: 'library',
    q: '',
    filter: 'all',
    sort: 'saved',
    limit: '20',
  });
  expect(result.current.favoriteItems).toHaveLength(1);
  expect(result.current.total).toBe(30);
  expect(mockWriteCount).toHaveBeenLastCalledWith(30);
});

it('收藏变更后重新拉取', async () => {
  mockFetch
    .mockResolvedValueOnce(response(page(30)))
    .mockResolvedValueOnce(response(page(31)));
  const { result } = renderHook(() => useFavoriteItems(0));
  await waitFor(() => expect(result.current.total).toBe(30));
  act(() => mockListeners.get('favoritesUpdated')?.());
  await waitFor(() => expect(result.current.total).toBe(31));
});
