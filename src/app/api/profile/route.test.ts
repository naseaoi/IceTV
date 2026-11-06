/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  requireAdmin: jest.fn(),
  isGuardFailure: (value: { response?: unknown }) => Boolean(value.response),
}));
jest.mock('@/lib/db', () => ({
  db: {
    ensureUserProfile: jest.fn(),
    updateUserProfile: jest.fn(),
    isNicknameAvailable: jest.fn(),
    getUserProfileById: jest.fn(),
    getUserProfileView: jest.fn(),
    getUserPublicReviewPage: jest.fn(),
    getUserFollowPage: jest.fn(),
    getFavoriteLibraryPage: jest.fn(),
    setUserFollow: jest.fn(),
    setVideoReviewLike: jest.fn(),
    reportVideoReview: jest.fn(),
    getReviewReportPage: jest.fn(),
    moderateReviewReports: jest.fn(),
  },
}));

installWebPolyfills();
const { NextResponse } = require('next/server');
const { requireActiveUser, requireAdmin } = require('@/lib/api-auth');
const { db } = require('@/lib/db');
const { NicknameTakenError } = require('@/lib/review-social-storage');
const profile = require('./route');
const availability = require('./nickname-availability/route');
const follows = require('../follows/route');
const likes = require('../reviews/likes/route');
const reports = require('../reviews/reports/route');
const admin = require('../admin/reviews/reports/route');
const user = require('../users/[profileId]/route');
const reviews = require('../users/[profileId]/reviews/route');
const favorites = require('../users/[profileId]/favorites/route');
const followList = require('../users/[profileId]/follows/route');
const context = { params: Promise.resolve({ profileId: 'AbCdEf012345' }) };
const target = {
  profileId: 'AbCdEf012345',
  title_norm: 'reviewdemo',
  year: '2026',
};
let requestNumber = 0;
function request(method = 'GET', body?: unknown, query = ''): NextRequest {
  return {
    method,
    nextUrl: new URL(`http://localhost/api/profile${query}`),
    headers: new Headers({ 'x-forwarded-for': `10.1.0.${++requestNumber}` }),
    json: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  jest.resetAllMocks();
  requireActiveUser.mockResolvedValue({ username: 'reader', role: 'user' });
  requireAdmin.mockResolvedValue({ username: 'admin', role: 'admin' });
  db.ensureUserProfile.mockResolvedValue({
    username: 'reader',
    profile_id: 'Reader012345',
    nickname: 'Reader',
    avatar_seed: null,
    favorites_public: 0,
  });
  db.getUserProfileById.mockResolvedValue({
    username: 'author',
    profile_id: target.profileId,
    nickname: 'Author',
    favorites_public: 0,
  });
  db.getUserPublicReviewPage.mockResolvedValue({ items: [], nextCursor: null });
  db.getUserFollowPage.mockResolvedValue({ items: [], nextCursor: null });
  db.getFavoriteLibraryPage.mockResolvedValue({
    items: [],
    total: 0,
    nextCursor: null,
  });
});

it('returns only public profile fields and validates updates', async () => {
  expect(await (await profile.GET(request())).json()).toEqual({
    profileId: 'Reader012345',
    nickname: 'Reader',
    avatarSeed: null,
    libraryVisibility: 0,
  });
  db.updateUserProfile.mockResolvedValue({
    profile_id: 'Reader012345',
    nickname: 'NewName',
    favorites_public: 1,
  });
  expect(
    (
      await profile.PUT(
        request('PUT', { nickname: 'NewName', favoritesPublic: true }),
      )
    ).status,
  ).toBe(200);
  expect(db.updateUserProfile).toHaveBeenCalledWith('reader', {
    nickname: 'NewName',
    libraryVisibility: 1,
  });
  expect(
    (await profile.PUT(request('PUT', { nickname: 'admin' }))).status,
  ).toBe(400);
  expect(
    (await profile.PUT(request('PUT', { favoritesPublic: 'yes' }))).status,
  ).toBe(400);
  db.updateUserProfile.mockRejectedValueOnce(new NicknameTakenError());
  const duplicate = await profile.PUT(request('PUT', { nickname: 'NewName' }));
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ error: '昵称已被使用' });
});

it('allows reserved nicknames only for the owner', async () => {
  db.updateUserProfile.mockResolvedValue({
    profile_id: 'Owner0123456',
    nickname: '站长',
    favorites_public: 0,
  });
  expect((await profile.PUT(request('PUT', { nickname: '站长' }))).status).toBe(
    400,
  );
  requireActiveUser.mockResolvedValue({ username: 'boss', role: 'owner' });
  expect((await profile.PUT(request('PUT', { nickname: '站长' }))).status).toBe(
    200,
  );
  expect(db.updateUserProfile).toHaveBeenCalledWith('boss', {
    nickname: '站长',
  });
  db.isNicknameAvailable.mockResolvedValue(true);
  const query = `?${new URLSearchParams({ nickname: '管理员' })}`;
  expect(
    await (await availability.GET(request('GET', undefined, query))).json(),
  ).toEqual({ available: true });
  requireActiveUser.mockResolvedValue({ username: 'reader', role: 'user' });
  expect(
    (await (await availability.GET(request('GET', undefined, query))).json())
      .available,
  ).toBe(false);
});

it.each(['Avatar012345', 'a'.repeat(8), 'Z'.repeat(24), null])(
  'accepts avatar-only updates including reset: %s',
  async (avatarSeed) => {
    db.updateUserProfile.mockResolvedValue({
      profile_id: 'Reader012345',
      nickname: null,
      avatar_seed: avatarSeed,
      favorites_public: 0,
    });
    const response = await profile.PUT(request('PUT', { avatarSeed }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      profileId: 'Reader012345',
      nickname: null,
      avatarSeed,
      libraryVisibility: 0,
    });
    expect(db.updateUserProfile).toHaveBeenCalledWith('reader', { avatarSeed });
  },
);

it.each([
  '',
  'a'.repeat(7),
  'a'.repeat(25),
  'invalid-seed',
  '中文头像种子',
  123,
  {},
  [],
])('rejects invalid avatar seeds without writing: %j', async (avatarSeed) => {
  const response = await profile.PUT(request('PUT', { avatarSeed }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: '头像参数无效' });
  expect(db.updateUserProfile).not.toHaveBeenCalled();
});

it('checks public nickname availability while excluding the current user', async () => {
  db.isNicknameAvailable.mockResolvedValue(true);
  expect(
    await (
      await availability.GET(request('GET', undefined, '?nickname=Reader'))
    ).json(),
  ).toEqual({ available: true });
  expect(db.isNicknameAvailable).toHaveBeenCalledWith('Reader', 'reader');
  requireActiveUser.mockResolvedValue({
    response: NextResponse.json({}, { status: 401 }),
  });
  expect(
    (await availability.GET(request('GET', undefined, '?nickname=Reader')))
      .status,
  ).toBe(200);
  expect(db.isNicknameAvailable).toHaveBeenLastCalledWith('Reader', undefined);
});

it('requires a nickname for all social writes', async () => {
  db.ensureUserProfile.mockResolvedValue({ nickname: null });
  for (const [handler, method] of [
    [follows.PUT, 'PUT'],
    [follows.DELETE, 'DELETE'],
    [likes.PUT, 'PUT'],
    [likes.DELETE, 'DELETE'],
    [reports.POST, 'POST'],
  ] as const) {
    const response = await handler(request(method, target));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: '请先设置昵称',
      code: 'NICKNAME_REQUIRED',
    });
  }
  expect(db.setUserFollow).not.toHaveBeenCalled();
  expect(db.setVideoReviewLike).not.toHaveBeenCalled();
});

it('maps opaque identities to server usernames and validates reports', async () => {
  db.setVideoReviewLike.mockResolvedValue({ liked: true, likeCount: 2 });
  expect(await (await likes.PUT(request('PUT', target))).json()).toEqual({
    liked: true,
    likeCount: 2,
  });
  expect(db.setVideoReviewLike).toHaveBeenCalledWith(
    'author',
    'reviewdemo',
    '2026',
    'reader',
    true,
  );
  db.setVideoReviewLike.mockResolvedValue(null);
  expect(
    (
      await likes.DELETE(
        request('DELETE', undefined, `?${new URLSearchParams(target)}`),
      )
    ).status,
  ).toBe(404);
  db.reportVideoReview.mockResolvedValue(true);
  expect(
    await (
      await reports.POST(
        request('POST', { ...target, reason: 'spoiler', detail: ' detail ' }),
      )
    ).json(),
  ).toEqual({ ok: true });
  expect(db.reportVideoReview).toHaveBeenCalledWith(
    'author',
    'reviewdemo',
    '2026',
    'reader',
    'spoiler',
    'detail',
  );
  expect(
    (await reports.POST(request('POST', { ...target, reason: 'invalid' })))
      .status,
  ).toBe(400);
  expect(
    (
      await reports.POST(
        request('POST', {
          ...target,
          reason: 'other',
          detail: 'x'.repeat(201),
        }),
      )
    ).status,
  ).toBe(400);
});

it('respects favorite privacy and excludes live and private fields', async () => {
  expect(await (await favorites.GET(request(), context)).json()).toEqual({
    hidden: true,
    libraryVisibility: 0,
  });
  expect(db.getFavoriteLibraryPage).not.toHaveBeenCalled();
  requireActiveUser.mockResolvedValue({ username: 'AUTHOR', role: 'user' });
  db.getFavoriteLibraryPage.mockResolvedValue({
    items: [
      {
        key: 'vod+1',
        favorite: {
          title: 'Work',
          year: '2026',
          cover: '',
          source_name: 'Source',
          total_episodes: 1,
          save_time: 10,
          origin: 'vod',
          secret: 'private',
        },
        playRecord: { index: 2 },
      },
    ],
    total: 1,
    nextCursor: null,
  });
  const response = await (await favorites.GET(request(), context)).json();
  expect(response.hidden).toBe(false);
  expect(response.items).toHaveLength(1);
  expect(response.items[0]).not.toHaveProperty('secret');
  expect(response.items[0]).not.toHaveProperty('playRecord');
  expect(db.getFavoriteLibraryPage).toHaveBeenCalledWith('author', {
    query: '',
    filter: 'all',
    sort: 'saved',
    cursor: undefined,
    profileScope: 'self',
  });
  expect((await reviews.GET(request(), context)).status).toBe(200);
  expect(
    (
      await followList.GET(
        request('GET', undefined, '?type=followers'),
        context,
      )
    ).status,
  ).toBe(200);
  expect(
    (await followList.GET(request('GET', undefined, '?type=invalid'), context))
      .status,
  ).toBe(400);
  db.getUserProfileById.mockResolvedValue(null);
  expect((await user.GET(request(), context)).status).toBe(404);
});

it('传递绑定筛选的收藏库游标并返回失效提示', async () => {
  const { InvalidFavoriteLibraryQuery } =
    await import('@/features/favorites/lib/library-storage');
  db.getUserProfileById.mockResolvedValue({
    username: 'author',
    favorites_public: 2,
  });
  db.getFavoriteLibraryPage.mockResolvedValue({
    items: [],
    nextCursor: 'next',
  });
  const response = await favorites.GET(
    request('GET', undefined, '?cursor=bound&filter=completed'),
    context,
  );
  expect((await response.json()).nextCursor).toBe('next');
  expect(db.getFavoriteLibraryPage).toHaveBeenCalledWith('author', {
    query: '',
    filter: 'completed',
    sort: 'saved',
    cursor: 'bound',
    profileScope: 'public',
  });
  db.getFavoriteLibraryPage.mockRejectedValue(
    new InvalidFavoriteLibraryQuery('收藏分页游标已失效，请重新加载'),
  );
  expect(
    (await favorites.GET(request('GET', undefined, '?cursor=invalid'), context))
      .status,
  ).toBe(400);
});

it.each([0, 1, 2, 3])(
  '资料 API 保存数字公开等级 %s',
  async (libraryVisibility) => {
    db.updateUserProfile.mockResolvedValue({
      profile_id: 'Reader012345',
      nickname: 'Reader',
      avatar_seed: null,
      favorites_public: libraryVisibility,
    });
    const response = await profile.PUT(request('PUT', { libraryVisibility }));
    expect(response.status).toBe(200);
    expect((await response.json()).libraryVisibility).toBe(libraryVisibility);
    expect(db.updateUserProfile).toHaveBeenCalledWith('reader', {
      libraryVisibility,
    });
  },
);

it.each([-1, 4, 1.5, '2', null, true])(
  '拒绝非法公开等级 %j',
  async (libraryVisibility) => {
    expect(
      (await profile.PUT(request('PUT', { libraryVisibility }))).status,
    ).toBe(400);
    expect(db.updateUserProfile).not.toHaveBeenCalled();
  },
);

it.each([1, 2, 3])(
  '公开收藏按等级 %s 裁剪状态与评分',
  async (libraryVisibility) => {
    db.getUserProfileById.mockResolvedValue({
      username: 'author',
      favorites_public: libraryVisibility,
    });
    db.getFavoriteLibraryPage.mockResolvedValue({
      items: [
        {
          key: 'douban+1',
          favorite: { title: 'Demo', save_time: 10 },
          watchStatus: 'completed',
          myRating: 8,
        },
      ],
      nextCursor: null,
    });
    const body = await (await favorites.GET(request(), context)).json();
    expect(body.libraryVisibility).toBe(libraryVisibility);
    expect(body.items[0].watchStatus).toBe(
      libraryVisibility >= 2 ? 'completed' : undefined,
    );
    expect(body.items[0].rating).toBe(libraryVisibility >= 3 ? 8 : undefined);
    if (libraryVisibility === 1)
      expect(
        (
          await favorites.GET(
            request('GET', undefined, '?filter=completed'),
            context,
          )
        ).status,
      ).toBe(400);
  },
);

it('returns follow status and grouped admin reports and applies moderation', async () => {
  db.setUserFollow.mockResolvedValue({ following: true, followerCount: 1 });
  expect(await (await follows.PUT(request('PUT', target))).json()).toEqual({
    following: true,
    followerCount: 1,
  });
  db.getReviewReportPage.mockResolvedValue({
    items: [],
    nextCursor: null,
    pendingTotal: 0,
  });
  expect(await (await admin.GET(request())).json()).toEqual({
    items: [],
    nextCursor: null,
    pendingTotal: 0,
  });
  expect(
    (
      await admin.POST(
        request('POST', {
          username: 'AUTHOR',
          title_norm: 'reviewdemo',
          year: '2026',
          action: 'mark-spoiler',
        }),
      )
    ).status,
  ).toBe(200);
  expect(db.moderateReviewReports).toHaveBeenCalledWith(
    'author',
    'reviewdemo',
    '2026',
    'mark-spoiler',
  );
  requireAdmin.mockResolvedValue({
    response: NextResponse.json({}, { status: 403 }),
  });
  expect((await admin.GET(request())).status).toBe(403);
});

it('enforces the active-user guard for protected routes', async () => {
  requireActiveUser.mockResolvedValue({
    response: NextResponse.json({}, { status: 401 }),
  });
  for (const handler of [profile.GET, follows.PUT, likes.PUT, reports.POST])
    expect((await handler(request())).status).toBe(401);
  for (const handler of [user.GET, reviews.GET, favorites.GET, followList.GET])
    expect((await handler(request(), context)).status).toBe(401);
});
