/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockSaveFavorite = jest.fn();
const mockGetFavoritePage = jest.fn();

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest
    .fn()
    .mockResolvedValue({ username: 'demo', isOwner: false, role: 'user' }),
  isGuardFailure: (result: object) => 'response' in result,
}));

jest.mock('@/lib/db', () => ({
  db: {
    getFavoritePage: (...args: unknown[]) => mockGetFavoritePage(...args),
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
