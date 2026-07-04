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

const { GET } = require('./route') as typeof import('./route');

function createRequest(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

describe('douban recommends route input validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects kind values outside the whitelist', async () => {
    const response = await GET(
      createRequest('http://localhost/api/douban/recommends?kind=book'),
    );

    await expect(response.json()).resolves.toEqual({
      error: 'kind 参数必须是 tv 或 movie',
    });
    expect(response.status).toBe(400);
    expect(fetchDoubanData).not.toHaveBeenCalled();
  });

  it('rejects NaN limit values', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/douban/recommends?kind=movie&limit=abc',
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
        'http://localhost/api/douban/recommends?kind=movie&start=abc',
      ),
    );

    expect(response.status).toBe(400);
    expect(fetchDoubanData).not.toHaveBeenCalled();
  });

  it('serves valid requests with integer paging', async () => {
    (fetchDoubanData as jest.Mock).mockResolvedValue({ items: [] });

    const response = await GET(
      createRequest(
        'http://localhost/api/douban/recommends?kind=movie&limit=30&start=10',
      ),
    );

    expect(response.status).toBe(200);
    expect(fetchDoubanData).toHaveBeenCalledWith(
      expect.stringContaining('start=10&count=30'),
    );
  });

  it('falls back to default paging when limit and start are omitted', async () => {
    (fetchDoubanData as jest.Mock).mockResolvedValue({ items: [] });

    const response = await GET(
      createRequest('http://localhost/api/douban/recommends?kind=tv'),
    );

    expect(response.status).toBe(200);
    expect(fetchDoubanData).toHaveBeenCalledWith(
      expect.stringContaining('start=0&count=20'),
    );
  });
});
