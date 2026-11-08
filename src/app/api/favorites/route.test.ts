/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockSaveFavorite = jest.fn();
const mockGetFavoriteForWork = jest.fn();
const mockGetFavoritePage = jest.fn();
const mockGetFavoriteLibraryPage = jest.fn();
const mockGetAllFavorites = jest.fn();

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest
    .fn()
    .mockResolvedValue({ username: 'demo', isOwner: false, role: 'user' }),
  isGuardFailure: (result: object) => 'response' in result,
}));

jest.mock('@/lib/db', () => ({
  db: {
    getFavoriteForWork: (...args: unknown[]) => mockGetFavoriteForWork(...args),
    getFavoritePage: (...args: unknown[]) => mockGetFavoritePage(...args),
    getFavoriteLibraryPage: (...args: unknown[]) =>
      mockGetFavoriteLibraryPage(...args),
    getAllFavorites: (...args: unknown[]) => mockGetAllFavorites(...args),
    saveFavorite: (...args: unknown[]) => mockSaveFavorite(...args),
  },
}));

const { GET, POST } = require('./route') as typeof import('./route');

function createRequest(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

function createJsonRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('favorites route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveFavorite.mockResolvedValue(undefined);
    mockGetFavoritePage.mockResolvedValue({
      items: [],
      total: 25,
      nextCursor: '1000|source+video-1',
    });
  });

  it('保存收藏时由服务端记录元数据检查时间', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1234);

    try {
      const response = await POST(
        createJsonRequest({
          key: 'source+video-1',
          favorite: {
            title: '测试视频',
            source_name: '测试源',
            cover: '',
            year: '2026',
            total_episodes: 12,
            save_time: 1000,
            metadata_checked_at: Number.MAX_SAFE_INTEGER,
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(mockSaveFavorite).toHaveBeenCalledWith(
        'demo',
        'source',
        'video-1',
        expect.objectContaining({ metadata_checked_at: 1234 }),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('收藏库模式返回服务端计数与评分，并保留无参数全量协议', async () => {
    const page = {
      items: [],
      counts: { all: 9, planned: 7, watching: 1, completed: 1, reviewed: 1 },
      total: 1,
      libraryTotal: 30,
      nextCursor: null,
    };
    mockGetFavoriteLibraryPage.mockResolvedValue(page);
    const response = await GET(
      createRequest(
        'http://localhost/api/favorites?format=library&q=test&filter=reviewed&sort=rating&cursor=token',
      ),
    );
    expect(await response.json()).toEqual(page);
    expect(mockGetFavoriteLibraryPage).toHaveBeenCalledWith('demo', {
      query: 'test',
      filter: 'reviewed',
      sort: 'rating',
      cursor: 'token',
    });
    expect(mockGetAllFavorites).not.toHaveBeenCalled();
    mockGetAllFavorites.mockResolvedValue({ 'source+1': { title: 'Demo' } });
    expect(
      await (await GET(createRequest('http://localhost/api/favorites'))).json(),
    ).toEqual({ 'source+1': { title: 'Demo' } });
  });

  it('条件绑定不匹配的游标返回 400', async () => {
    const { InvalidFavoriteLibraryQuery } =
      await import('@/features/favorites/lib/library-storage');
    mockGetFavoriteLibraryPage.mockRejectedValue(
      new InvalidFavoriteLibraryQuery('收藏分页游标已失效，请重新加载'),
    );
    const response = await GET(
      createRequest('http://localhost/api/favorites?format=library&cursor=bad'),
    );
    expect(response.status).toBe(400);
  });

  it('分页查询不读取全量收藏', async () => {
    const response = await GET(
      createRequest('http://localhost/api/favorites?format=page&limit=24'),
    );

    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 25,
      nextCursor: '1000|source+video-1',
    });
    expect(mockGetFavoritePage).toHaveBeenCalledWith(
      'demo',
      24,
      undefined,
      undefined,
    );
  });
});

it.each([
  { watch_status: 'bad' },
  { watch_status: 'completed', watched_at: -1 },
  { watch_status: 'watching', watched_at: 123 },
  { watch_status: 'completed', watched_at: '123' },
])('收藏 POST 拒绝非法状态与日期 %j', async (fields) => {
  const response = await POST(
    createJsonRequest({
      key: 'source+1',
      favorite: { title: '测试', source_name: '源', ...fields },
    }),
  );
  expect(response.status).toBe(400);
});

it('目录收藏响应最终真实源键并规范化来源名', async () => {
  mockSaveFavorite.mockResolvedValue('source+1');
  const response = await POST(
    createJsonRequest({
      key: 'douban+123',
      favorite: {
        title: '测试',
        source_name: '伪名称',
        watch_status: 'completed',
        watched_at: 123,
      },
    }),
  );
  expect(await response.json()).toEqual({ success: true, key: 'source+1' });
  expect(mockSaveFavorite).toHaveBeenLastCalledWith(
    'demo',
    'douban',
    '123',
    expect.objectContaining({
      source_name: '豆瓣',
      watch_status: 'completed',
      watched_at: 123,
    }),
  );
});

it('作品查询返回有效状态条目或 null', async () => {
  mockGetFavoriteForWork.mockResolvedValue({
    key: 'source+1',
    watchStatus: 'planned',
  });
  const response = await GET(
    createRequest(
      'http://localhost/api/favorites?format=work&key=douban%2B123&title=Demo&year=2026',
    ),
  );
  expect(await response.json()).toEqual({
    key: 'source+1',
    watchStatus: 'planned',
  });
  expect(mockGetFavoriteForWork).toHaveBeenCalledWith('demo', {
    key: 'douban+123',
    title: 'Demo',
    year: '2026',
  });
});

it.each([
  null,
  [],
  { key: 123, favorite: {} },
  { key: 'source+1', favorite: 'bad' },
])('拒绝非法请求结构 %j', async (body) => {
  expect((await POST(createJsonRequest(body))).status).toBe(400);
});
