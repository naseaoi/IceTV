/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';
import { LocalSqliteStorage } from '@/lib/sqlite.db';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: (value: { response?: unknown }) => !!value.response,
}));
jest.mock('@/lib/db', () => ({ db: { getPublicReview: jest.fn() } }));
installWebPolyfills();
const { NextResponse } = require('next/server');
const { requireActiveUser } = require('@/lib/api-auth');
const { db } = require('@/lib/db');
const route = require('./route') as typeof import('./route');
const request = (query: Record<string, string> = {}) =>
  ({
    nextUrl: new URL(
      `http://localhost/api/reviews/single?${new URLSearchParams(query)}`,
    ),
  }) as NextRequest;

it('单条评价要求登录与合法精确身份', async () => {
  requireActiveUser.mockResolvedValue({
    response: NextResponse.json({}, { status: 401 }),
  });
  expect((await route.GET(request())).status).toBe(401);
  requireActiveUser.mockResolvedValue({ username: 'author' });
  expect((await route.GET(request())).status).toBe(400);
});
it('实际存储只返回公开评价，附带当前访问者点赞和回复数量', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const profile = await storage.ensureUserProfile('author');
  await storage.ensureUserProfile('reader');
  await storage.setVideoReview('author', videoReview);
  await storage.setVideoReviewLike(
    'author',
    videoReview.title_norm,
    videoReview.year,
    'reader',
    true,
  );
  await storage.postReviewReply(
    'author',
    videoReview.title_norm,
    videoReview.year,
    'reader',
    '回复',
  );
  requireActiveUser.mockResolvedValue({ username: 'reader' });
  db.getPublicReview.mockImplementation(storage.getPublicReview.bind(storage));
  const query = {
    profileId: profile.profile_id,
    title_norm: videoReview.title_norm,
    year: videoReview.year,
  };
  expect(await (await route.GET(request(query))).json()).toMatchObject({
    review: { replyCount: 1, likedByMe: true },
  });
  await storage.setVideoReview('author', { ...videoReview, is_public: false });
  expect(await (await route.GET(request(query))).json()).toEqual({
    review: null,
  });
});
