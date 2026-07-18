import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { fetchDoubanData } from '@/lib/douban';

installWebPolyfills();

jest.mock('@/lib/config', () => ({
  getCacheTime: jest.fn().mockResolvedValue(300),
}));

jest.mock('@/lib/douban', () => ({
  fetchDoubanData: jest.fn(),
}));

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest
    .fn()
    .mockResolvedValue({ username: 'demo', isOwner: false, role: 'user' }),
  isGuardFailure: (result: object) => 'response' in result,
}));

const { GET } = require('./route') as typeof import('./route');

function createRequest(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

describe('douban categories route input validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects NaN limit values', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/douban/categories?kind=tv&category=%E7%83%AD%E9%97%A8&type=tv&limit=abc',
      ),
    );

    await expect(response.json()).resolves.toEqual({
      error: 'pageSize 必须在 1-100 之间',
    });
    expect(response.status).toBe(400);
    expect(fetchDoubanData).not.toHaveBeenCalled();
  });

  it('rejects NaN start values', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/douban/categories?kind=tv&category=%E7%83%AD%E9%97%A8&type=tv&start=abc',
      ),
    );

    expect(response.status).toBe(400);
    expect(fetchDoubanData).not.toHaveBeenCalled();
  });

  it('encodes category and type before requesting douban', async () => {
    (fetchDoubanData as jest.Mock).mockResolvedValue({ items: [] });

    const response = await GET(
      createRequest(
        'http://localhost/api/douban/categories?kind=tv&category=%E7%BE%8E%E5%89%A7%20%26%20%E9%9F%A9%E5%89%A7&type=tv',
      ),
    );

    expect(response.status).toBe(200);
    expect(fetchDoubanData).toHaveBeenCalledWith(
      expect.stringContaining(
        'category=%E7%BE%8E%E5%89%A7%20%26%20%E9%9F%A9%E5%89%A7',
      ),
    );
  });
});
