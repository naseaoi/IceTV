/** @jest-environment node */

const mockDb = {
  getFavoriteLibraryPage: jest.fn(),
  getMyVideoReviewCount: jest.fn(),
  getWatchHistoryPage: jest.fn(),
  getPlayRecordPage: jest.fn(),
};

jest.mock('server-only', () => ({}));
jest.mock('@/lib/db', () => ({ db: mockDb }));
jest.mock('@/lib/config', () => ({
  getConfigForRead: async () => ({
    SiteConfig: {
      PlaybackHistoryPageSize: 10,
      ContinueWatchingLimit: 8,
    },
  }),
}));

const { seedListCountCookies } =
  require('@/lib/list-count-seed.server') as typeof import('@/lib/list-count-seed.server');

function createResponse() {
  const set = jest.fn();
  return {
    response: { cookies: { set } } as never,
    values: () =>
      Object.fromEntries(set.mock.calls.map(([name, value]) => [name, value])),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.getFavoriteLibraryPage.mockResolvedValue({ libraryTotal: 5 });
  mockDb.getMyVideoReviewCount.mockResolvedValue(1);
  mockDb.getPlayRecordPage.mockResolvedValue({ total: 30 });
  // 同名不同源的历史独立计数
  mockDb.getWatchHistoryPage.mockResolvedValue([
    { id: 'a', title: '甲', source: 's1', started_at: 3, watch_seconds: 60 },
    { id: 'b', title: '甲', source: 's1', started_at: 2, watch_seconds: 60 },
    { id: 'c', title: '乙', source: 's1', started_at: 1, watch_seconds: 60 },
  ]);
});

it('按各列表接口口径写入计数', async () => {
  const { response, values } = createResponse();
  await seedListCountCookies(response, 'alice');
  expect(mockDb.getFavoriteLibraryPage).toHaveBeenCalledWith('alice', {
    query: '',
    filter: 'all',
    sort: 'saved',
    limit: 1,
  });
  expect(values()).toEqual({
    fav_count: '5',
    review_count: '1',
    history_count: '3',
    cw_count: '8',
    cw_page_count: '24',
  });
});

it('历史计数只查询首页', async () => {
  mockDb.getWatchHistoryPage.mockResolvedValue(
    Array.from({ length: 10 }, (_, index) => ({
      id: `s${index}`,
      title: `作品${index}`,
      source: 's1',
      started_at: 100 - index,
      watch_seconds: 60,
    })),
  );
  const { response, values } = createResponse();
  await seedListCountCookies(response, 'alice');
  expect(mockDb.getWatchHistoryPage).toHaveBeenCalledWith('alice', {
    limit: 10,
  });
  expect(values().history_count).toBe('10');
});

it('查询失败时不写入计数也不影响登录响应', async () => {
  mockDb.getMyVideoReviewCount.mockRejectedValue(new Error('db down'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const { response, values } = createResponse();
  await expect(
    seedListCountCookies(response, 'alice'),
  ).resolves.toBeUndefined();
  expect(values()).toEqual({});
  warn.mockRestore();
});
