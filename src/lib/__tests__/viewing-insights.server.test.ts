/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: (value: { response?: unknown }) => !!value.response,
}));
jest.mock('@/lib/db', () => ({
  db: {
    getFollowOpinions: jest.fn(),
  },
}));
installWebPolyfills();
const { NextResponse } = require('next/server') as typeof import('next/server');
const { GET: opinions } =
  require('@/app/api/follows/opinions/route') as typeof import('@/app/api/follows/opinions/route');
const request = (query: string): NextRequest =>
  ({
    nextUrl: new URL(`http://localhost/api/test?${query}`),
    method: 'GET',
  }) as NextRequest;
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(requireActiveUser)
    .mockResolvedValue({ username: 'VIEWER' } as Awaited<
      ReturnType<typeof requireActiveUser>
    >);
});
it('关注看法要求登录', async () => {
  jest.mocked(requireActiveUser).mockResolvedValue({
    response: NextResponse.json({ error: '请先登录' }, { status: 401 }),
  });
  expect((await opinions(request('title=作品'))).status).toBe(401);
  expect(db.getFollowOpinions).not.toHaveBeenCalled();
});
it('关注看法校验作品并返回禁止缓存的汇总', async () => {
  const data = {
    watchedCount: 0,
    ratedCount: 0,
    averageRating: null,
    items: [],
  };
  jest.mocked(db.getFollowOpinions).mockResolvedValue(data);
  expect((await opinions(request(''))).status).toBe(400);
  const response = await opinions(request('title=Review%20Demo&year=2026'));
  expect(db.getFollowOpinions).toHaveBeenCalledWith(
    'viewer',
    'reviewdemo',
    '2026',
  );
  expect(await response.json()).toEqual(data);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
});
it('异常细节只留服务端', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.mocked(db.getFollowOpinions).mockRejectedValue(new Error('secret'));
  const response = await opinions(request('title=作品'));
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('secret');
  log.mockRestore();
});
