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

function request(id: string): NextRequest {
  return new Request(
    `http://localhost/api/douban/rating?id=${encodeURIComponent(id)}`,
  ) as unknown as NextRequest;
}

describe('douban rating route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects non-numeric ids without requesting douban', async () => {
    const response = await GET(request('../1'));
    expect(response.status).toBe(400);
    expect(fetchDoubanData).not.toHaveBeenCalled();
  });

  it('returns the parsed rate and serves repeats from cache', async () => {
    (fetchDoubanData as jest.Mock).mockResolvedValue({
      subject: { rate: '9.4' },
    });

    const first = await GET(request('23748525'));
    await expect(first.json()).resolves.toEqual({ rate: 9.4 });

    const second = await GET(request('23748525'));
    await expect(second.json()).resolves.toEqual({ rate: 9.4 });
    expect(fetchDoubanData).toHaveBeenCalledTimes(1);
    expect(fetchDoubanData).toHaveBeenCalledWith(
      'https://movie.douban.com/j/subject_abstract?subject_id=23748525',
      expect.anything(),
    );
  });

  it.each([
    ['1001', { subject: { rate: '' } }],
    ['1002', { r: 'error' }],
  ])('returns null when douban has no rate for %s', async (id, payload) => {
    (fetchDoubanData as jest.Mock).mockResolvedValue(payload);
    const response = await GET(request(id));
    await expect(response.json()).resolves.toEqual({ rate: null });
  });
});
