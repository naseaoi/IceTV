/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';

jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn(),
  isGuardFailure: jest.fn(),
}));
jest.mock('@/lib/db', () => ({ db: { queryInviteCodes: jest.fn() } }));
installWebPolyfills();

const { GET } = require('./route') as typeof import('./route');

const request = (query = '') =>
  ({
    nextUrl: new URL(`http://localhost/api/admin/invite-codes${query}`),
  }) as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({
    username: 'admin',
    isOwner: false,
  });
  (isGuardFailure as unknown as jest.Mock).mockReturnValue(false);
  (db.queryInviteCodes as jest.Mock).mockResolvedValue({
    items: [],
    total: 0,
    activeCount: 0,
    nextCursor: null,
  });
});

it('管理员分页读取返回数量和 no-store', async () => {
  const response = await GET(request('?filter=active&limit=20&cursor=test'));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(db.queryInviteCodes).toHaveBeenCalledWith({
    filter: 'active',
    limit: 20,
    cursor: 'test',
  });
  expect(await response.json()).toEqual({
    items: [],
    total: 0,
    activeCount: 0,
    nextCursor: null,
  });
});

it('未使用筛选透传分页参数与匹配数量', async () => {
  const page = {
    items: [{ code: 'UNUSED', usedCount: 0 }],
    total: 2,
    activeCount: 3,
    inactiveCount: 1,
    nextCursor: 'next',
  };
  (db.queryInviteCodes as jest.Mock).mockResolvedValue(page);
  const response = await GET(request('?filter=unused&limit=1&cursor=previous'));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(db.queryInviteCodes).toHaveBeenCalledWith({
    filter: 'unused',
    limit: 1,
    cursor: 'previous',
  });
  expect(await response.json()).toEqual(page);
});

it('未使用筛选保留空结果', async () => {
  const response = await GET(request('?filter=unused'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    items: [],
    total: 0,
    nextCursor: null,
  });
});

it.each(['?filter=nope', '?limit=0', '?limit=101', '?limit=1.5'])(
  '拒绝参数 %s',
  async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(db.queryInviteCodes).not.toHaveBeenCalled();
  },
);

it('拒绝不匹配筛选条件的游标', async () => {
  (db.queryInviteCodes as jest.Mock).mockRejectedValue(
    new Error('邀请码游标无效'),
  );
  expect((await GET(request('?cursor=bad'))).status).toBe(400);
});

it('鉴权失败直接返回 guard 响应', async () => {
  const denied = new Response(null, { status: 403 });
  (requireAdmin as jest.Mock).mockResolvedValue({ response: denied });
  (isGuardFailure as unknown as jest.Mock).mockReturnValue(true);
  expect(await GET(request())).toBe(denied);
  expect(db.queryInviteCodes).not.toHaveBeenCalled();
});
