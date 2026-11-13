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
    getTasteMatch: jest.fn(),
    getUserProfileById: jest.fn(),
  },
}));
installWebPolyfills();
const { NextResponse } = require('next/server') as typeof import('next/server');
const { GET: opinions } =
  require('@/app/api/follows/opinions/route') as typeof import('@/app/api/follows/opinions/route');
const { GET: taste } =
  require('@/app/api/profile/taste-match/route') as typeof import('@/app/api/profile/taste-match/route');
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
it('两个接口都要求登录', async () => {
  jest.mocked(requireActiveUser).mockResolvedValue({
    response: NextResponse.json({ error: '请先登录' }, { status: 401 }),
  });
  expect((await opinions(request('title=作品'))).status).toBe(401);
  expect((await taste(request('profileId=abcdefghijkl'))).status).toBe(401);
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
it('相合度拒绝本人、无效与不存在的资料', async () => {
  expect((await taste(request('profileId=bad'))).status).toBe(400);
  jest.mocked(db.getUserProfileById).mockResolvedValue(null);
  expect((await taste(request('profileId=abcdefghijkl'))).status).toBe(404);
  jest
    .mocked(db.getUserProfileById)
    .mockResolvedValue({ username: 'viewer' } as NonNullable<
      Awaited<ReturnType<typeof db.getUserProfileById>>
    >);
  expect((await taste(request('profileId=abcdefghijkl'))).status).toBe(400);
  expect(db.getTasteMatch).not.toHaveBeenCalled();
});
it('相合度使用资料对应用户并返回公开推荐', async () => {
  jest
    .mocked(db.getUserProfileById)
    .mockResolvedValue({ username: 'peer' } as NonNullable<
      Awaited<ReturnType<typeof db.getUserProfileById>>
    >);
  jest
    .mocked(db.getTasteMatch)
    .mockResolvedValue({ commonCount: 3, score: null, picks: [] });
  const response = await taste(request('profileId=abcdefghijkl'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    commonCount: 3,
    score: null,
    picks: [],
  });
  expect(db.getTasteMatch).toHaveBeenCalledWith('viewer', 'peer');
});
it('异常细节只留服务端', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.mocked(db.getFollowOpinions).mockRejectedValue(new Error('secret'));
  const response = await opinions(request('title=作品'));
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('secret');
  log.mockRestore();
});
