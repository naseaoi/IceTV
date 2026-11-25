import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';

import { FavoritesPageClient } from '@/features/favorites/components/FavoritesPageClient';
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
jest.mock('@/features/favorites/components/FavoriteGrid', () => ({
  FavoriteGrid: ({ items }: { items: { id: string; title: string }[] }) => (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.title}</li>
      ))}
    </ul>
  ),
}));
jest.mock('@/lib/db.client', () => ({
  batchFavorites: jest.fn(),
  bindCatalogFavorites: jest.fn(),
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
  counts: { all: 100, planned: 100, watching: 0, completed: 0 },
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
  mockFetch.mockReset();
  mockListeners.clear();
});

it.each(['分类', '评价', '排序', '搜索'])(
  '%s 切换等待响应时保留旧卡片，确认空结果后再显示空状态',
  async (condition) => {
    let resolveNext!: (value: ReturnType<typeof response>) => void;
    mockFetch
      .mockResolvedValueOnce(response(page('旧作品')))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNext = resolve;
          }),
      );
    const { container } = render(<FavoritesPageClient />);
    expect(await screen.findByText('旧作品')).toBeInTheDocument();

    if (condition === '分类') {
      fireEvent.click(screen.getByRole('button', { name: /^看过/ }));
    } else if (condition === '搜索') {
      fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏' }), {
        target: { value: '新关键词' },
      });
    } else {
      fireEvent.click(screen.getByRole('button', { name: condition }));
      fireEvent.click(
        screen.getByRole('option', {
          name: condition === '评价' ? '未评价' : '我的评分',
        }),
      );
    }
    expect(screen.getByText('旧作品')).toBeInTheDocument();
    expect(screen.queryByText('没有匹配的收藏')).not.toBeInTheDocument();
    expect(screen.queryByText('还没有收藏')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toHaveAttribute(
      'inert',
    );
    expect(container.querySelector('[inert]')).toHaveClass('opacity-60');
    expect(
      screen.getByRole('searchbox', { name: '搜索收藏' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '多选' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '清空收藏' })).toBeDisabled();

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    await act(async () =>
      resolveNext(response({ ...page(''), items: [], total: 0 })),
    );
    expect(screen.queryByText('旧作品')).not.toBeInTheDocument();
    expect(screen.getByText('没有匹配的收藏')).toBeInTheDocument();
    expect(container.querySelector('[inert]')).toBeNull();
  },
);

it('清除搜索期间保留旧空状态及其关键词，等待新结果替换', async () => {
  mockFetch
    .mockResolvedValueOnce(response(page('旧作品')))
    .mockResolvedValueOnce(response({ ...page(''), items: [], total: 0 }))
    .mockImplementationOnce(() => new Promise(() => {}));
  const { container } = render(<FavoritesPageClient />);
  await screen.findByText('旧作品');
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索收藏' }), {
    target: { value: '查无此片' },
  });
  await screen.findByText('找不到与「查无此片」相关的作品');
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  expect(screen.getByText('没有匹配的收藏')).toBeInTheDocument();
  expect(
    screen.getByText('找不到与「查无此片」相关的作品'),
  ).toBeInTheDocument();
  expect(container.querySelector('[aria-busy="true"]')).toHaveAttribute(
    'inert',
  );
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
  await waitFor(() =>
    expect(result.current.error).toBe('收藏加载失败，请重试'),
  );
  expect(result.current.items[0].title).toBe('1');
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
    ({ review }: { review: 'all' | 'reviewed' }) =>
      useFavoriteLibrary(0, {
        query: '',
        filter: 'all',
        review,
        sort: 'saved',
      }),
    { initialProps: { review: 'all' } },
  );
  await waitFor(() => expect(result.current.loading).toBe(false));

  rerender({ review: 'reviewed' });
  expect(result.current.loading).toBe(false);
  expect(result.current.refreshing).toBe(true);
  expect(result.current.items[0].title).toBe('all');
  await act(async () => resolveReviewed(response(page('reviewed'))));
  expect(result.current.refreshing).toBe(false);
  expect(result.current.items[0].title).toBe('reviewed');

  rerender({ review: 'all' });
  expect(result.current.items[0].title).toBe('all');
  expect(result.current.refreshing).toBe(true);
});

it('首次组合筛选条数未知时保持未知，响应后使用交集条数且总数 cookie 不受筛选影响', async () => {
  let resolvePage!: (value: ReturnType<typeof response>) => void;
  mockFetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePage = resolve;
      }),
  );
  const { result } = renderHook(() =>
    useFavoriteLibrary(100, {
      query: '',
      filter: 'completed',
      review: 'unreviewed',
      sort: 'saved',
    }),
  );
  expect(result.current.skeletonCount).toBeNull();
  expect(result.current.countsLoading).toBe(true);
  const url = new URL(mockFetch.mock.calls[0][0], 'http://localhost');
  expect(url.searchParams.get('filter')).toBe('completed');
  expect(url.searchParams.get('review')).toBe('unreviewed');
  await act(async () =>
    resolvePage(
      response({
        ...page('filtered'),
        total: 0,
        items: [],
        counts: { all: 3, planned: 3, watching: 0, completed: 0 },
      }),
    ),
  );
  expect(result.current.skeletonCount).toBe(0);
  expect(result.current.countsLoading).toBe(false);
  expect(result.current.total).toBe(0);
  expect(result.current.counts.planned).toBe(3);
  expect(mockWriteCount).toHaveBeenLastCalledWith(100);
});
