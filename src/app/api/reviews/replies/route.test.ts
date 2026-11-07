/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { ReviewValidationError } from '@/lib/video-reviews';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  requireAdmin: jest.fn(),
  isGuardFailure: (value: { response?: unknown }) => !!value.response,
}));
jest.mock('@/lib/db', () => ({
  db: {
    ensureUserProfile: jest.fn(),
    getUserProfileById: jest.fn(),
    getReviewReplies: jest.fn(),
    postReviewReply: jest.fn(),
    deleteReviewReply: jest.fn(),
    reportReviewReply: jest.fn(),
  },
}));

installWebPolyfills();
const { NextResponse } = require('next/server');
const { requireActiveUser, requireAdmin } = require('@/lib/api-auth');
const { db } = require('@/lib/db');
const route = require('./route') as typeof import('./route');
const reports = require('./reports/route') as typeof import('./reports/route');
const admin =
  require('../../admin/reviews/replies/route') as typeof import('../../admin/reviews/replies/route');
const id = '00000000-0000-4000-8000-000000000001';
const target = { profileId: 'Author000001', title_norm: 'work', year: '2026' };
function request(method: string, body?: unknown, query = ''): NextRequest {
  return {
    method,
    nextUrl: new URL(`http://localhost/api/reviews/replies${query}`),
    json: async () => body,
  } as NextRequest;
}
beforeEach(() => {
  jest.resetAllMocks();
  requireActiveUser.mockResolvedValue({ username: 'reader', role: 'user' });
  requireAdmin.mockResolvedValue({ username: 'admin', role: 'admin' });
  db.ensureUserProfile.mockResolvedValue({ nickname: '读者' });
  db.getUserProfileById.mockResolvedValue({ username: 'author' });
  db.getReviewReplies.mockResolvedValue({ items: [], nextCursor: null });
  db.postReviewReply.mockResolvedValue({ id });
  db.deleteReviewReply.mockResolvedValue(true);
  db.reportReviewReply.mockResolvedValue(true);
});

it('所有入口要求有效登录，管理删除要求管理员', async () => {
  requireActiveUser.mockResolvedValue({
    response: NextResponse.json({ error: '未登录' }, { status: 401 }),
  });
  expect((await route.GET(request('GET'))).status).toBe(401);
  expect((await route.POST(request('POST'))).status).toBe(401);
  expect((await route.DELETE(request('DELETE'))).status).toBe(401);
  expect((await reports.POST(request('POST'))).status).toBe(401);
  requireAdmin.mockResolvedValue({
    response: NextResponse.json({ error: '权限不足' }, { status: 403 }),
  });
  expect(
    (await admin.DELETE(request('DELETE', undefined, `?id=${id}`))).status,
  ).toBe(403);
});

it('发送和举报缺昵称返回 NICKNAME_REQUIRED，读取与删除保留可用', async () => {
  db.ensureUserProfile.mockResolvedValue({ nickname: null });
  for (const handler of [route.POST, reports.POST]) {
    const response = await handler(
      request('POST', { ...target, id, content: '回复', reason: 'spam' }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('NICKNAME_REQUIRED');
  }
  expect(
    (
      await route.GET(
        request('GET', undefined, `?${new URLSearchParams(target)}`),
      )
    ).status,
  ).toBe(200);
  expect(
    (await route.DELETE(request('DELETE', undefined, `?id=${id}`))).status,
  ).toBe(200);
});

it('服务端解析作者并 trim 正文，跨评价引用拒绝', async () => {
  const response = await route.POST(
    request('POST', { ...target, content: ' 回复 ', replyToId: id }),
  );
  expect(response.status).toBe(200);
  expect(db.postReviewReply).toHaveBeenCalledWith(
    'author',
    'work',
    '2026',
    'reader',
    '回复',
    id,
  );
  db.postReviewReply.mockRejectedValue(
    new ReviewValidationError('被回复内容不存在或不属于该公开评价'),
  );
  expect(
    (
      await route.POST(
        request('POST', { ...target, content: '回复', replyToId: id }),
      )
    ).status,
  ).toBe(400);
});

it('拒绝空白、超长正文、非法引用和举报说明', async () => {
  for (const content of ['', '  ', '字'.repeat(301), 1])
    expect(
      (await route.POST(request('POST', { ...target, content }))).status,
    ).toBe(400);
  expect(
    (
      await route.POST(
        request('POST', { ...target, content: '回复', replyToId: 'invalid' }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await reports.POST(request('POST', { id, reason: 'invalid' }))).status,
  ).toBe(400);
  expect(
    (
      await reports.POST(
        request('POST', { id, reason: 'spam', detail: '字'.repeat(201) }),
      )
    ).status,
  ).toBe(400);
});

it('私密或不存在的评价不允许发送，列表与权限结果不泄露登录名', async () => {
  db.postReviewReply.mockResolvedValue(null);
  expect(
    (await route.POST(request('POST', { ...target, content: '回复' }))).status,
  ).toBe(404);
  const page = await route.GET(
    request('GET', undefined, `?${new URLSearchParams(target)}`),
  );
  expect(await page.json()).toEqual({ items: [], nextCursor: null });
  db.deleteReviewReply.mockResolvedValue(false);
  expect(
    (await route.DELETE(request('DELETE', undefined, `?id=${id}`))).status,
  ).toBe(404);
  expect(db.deleteReviewReply).toHaveBeenCalledWith(id, 'reader');
  await admin.DELETE(request('DELETE', undefined, `?id=${id}`));
  expect(db.deleteReviewReply).toHaveBeenCalledWith(id, 'admin', true);
});
