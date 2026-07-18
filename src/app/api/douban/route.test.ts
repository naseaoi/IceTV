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

describe('douban route input validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects NaN page size values', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/douban?type=movie&tag=热门&pageSize=NaN',
      ),
    );

    await expect(response.json()).resolves.toEqual({
      error: 'pageSize 必须在 1-100 之间',
    });
    expect(response.status).toBe(400);
    expect(fetchDoubanData).not.toHaveBeenCalled();
  });

  it('encodes tag values before requesting douban', async () => {
    (fetchDoubanData as jest.Mock).mockResolvedValue({ subjects: [] });

    const response = await GET(
      createRequest(
        'http://localhost/api/douban?type=movie&tag=%E7%A7%91%E5%B9%BB%20%26%20%E6%82%AC%E7%96%91&pageSize=16&pageStart=0',
      ),
    );

    expect(response.status).toBe(200);
    expect(fetchDoubanData).toHaveBeenCalledWith(
      expect.stringContaining(
        'tag=%E7%A7%91%E5%B9%BB%20%26%20%E6%82%AC%E7%96%91',
      ),
    );
  });
});
