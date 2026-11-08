/** @jest-environment node */

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { userDanmaku } from '@/lib/__tests__/__fixtures__/user-danmaku-contract';
import {
  isGuardFailure,
  requireActiveUser,
  requireAdmin,
} from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import { consumeSharedQuota } from '@/lib/shared-resource-quota.server';

jest.mock('@/lib/api-auth', () => ({
  isGuardFailure: jest.fn((value) => 'response' in value),
  requireActiveUser: jest.fn(),
  requireAdmin: jest.fn(),
}));
jest.mock('@/lib/config', () => ({ getConfigForRead: jest.fn() }));
jest.mock('@/lib/db', () => ({
  db: {
    getUserDanmaku: jest.fn(),
    addUserDanmaku: jest.fn(),
    deleteUserDanmaku: jest.fn(),
    getUserDanmakuPage: jest.fn(),
    deleteUserDanmakuBatch: jest.fn(),
  },
}));
jest.mock('@/lib/shared-resource-quota.server', () => ({
  consumeSharedQuota: jest.fn(),
  sharedResourceStore: jest.fn().mockResolvedValue({}),
  resourceKey: jest.fn((scope, name) => `${scope}:${name}`),
}));
installCryptoPolyfill();
installStreamPolyfills();
const { NextRequest, NextResponse } = require('next/server');
const own = require('./route') as typeof import('./route');
const admin =
  require('@/app/api/admin/danmaku/user/route') as typeof import('@/app/api/admin/danmaku/user/route');

function request(
  method = 'GET',
  query = '',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new NextRequest(`https://icetv.test/api/danmaku/user${query}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const valid = {
  key: 'dandan:123',
  time: 1.234,
  text: ' hello\u0000   world ',
  mode: 1,
  color: '#ABCDEF',
};
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(requireActiveUser)
    .mockResolvedValue({ username: 'alice', isOwner: false, role: 'user' });
  jest.mocked(requireAdmin).mockResolvedValue({
    username: 'admin',
    isOwner: false,
    isAdmin: true,
    role: 'admin',
  });
  jest.mocked(getConfigForRead).mockResolvedValue({
    SiteConfig: {
      EnableDanmaku: true,
      EnableUserDanmaku: true,
      DanmakuEpisodeLimit: 100,
    },
  } as never);
  jest.mocked(db.getUserDanmaku).mockResolvedValue([userDanmaku]);
  jest.mocked(db.addUserDanmaku).mockResolvedValue(undefined);
  jest.mocked(db.deleteUserDanmaku).mockResolvedValue(true);
  jest.mocked(db.getUserDanmakuPage).mockResolvedValue([]);
  jest.mocked(db.deleteUserDanmakuBatch).mockResolvedValue(1);
  jest.mocked(consumeSharedQuota).mockResolvedValue(undefined);
});

test('requires active user and admin guards', async () => {
  jest.mocked(requireActiveUser).mockResolvedValue({
    response: NextResponse.json({ error: '请先登录' }, { status: 401 }),
  });
  expect((await own.GET(request())).status).toBe(401);
  jest.mocked(requireAdmin).mockResolvedValue({
    response: NextResponse.json({ error: '权限不足' }, { status: 403 }),
  });
  expect((await admin.GET(request())).status).toBe(403);
  expect(
    (await admin.DELETE(request('DELETE', '', { ids: [userDanmaku.id] })))
      .status,
  ).toBe(403);
  expect(isGuardFailure).toHaveBeenCalled();
});

test.each(['EnableDanmaku', 'EnableUserDanmaku'])(
  'disables read/send with %s',
  async (field) => {
    jest.mocked(getConfigForRead).mockResolvedValue({
      SiteConfig: {
        EnableDanmaku: true,
        EnableUserDanmaku: true,
        [field]: false,
      },
    } as never);
    expect((await own.GET(request('GET', '?key=dandan:123'))).status).toBe(403);
    expect((await own.POST(request('POST', '', valid))).status).toBe(403);
    expect(
      (await own.DELETE(request('DELETE', `?id=${userDanmaku.id}`))).status,
    ).toBe(200);
  },
);

test('reads newest budget and sorts seconds, mine and no-store', async () => {
  jest
    .mocked(db.getUserDanmaku)
    .mockResolvedValue([
      userDanmaku,
      { ...userDanmaku, id: 'other', username: 'bob', timeMs: 1 },
    ]);
  const response = await own.GET(request('GET', '?key=dandan:123'));
  expect(db.getUserDanmaku).toHaveBeenCalledWith('dandan:123', 50);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const body = await response.json();
  expect(body.limit).toBe(100);
  expect(
    body.items.map((item: { time: number; mine: boolean }) => [
      item.time,
      item.mine,
    ]),
  ).toEqual([
    [0.001, false],
    [1.234, true],
  ]);
});

test('normalizes and sends millisecond row under shared user quota', async () => {
  const response = await own.POST(request('POST', '', valid));
  expect(response.status).toBe(200);
  expect(db.addUserDanmaku).toHaveBeenCalledWith(
    expect.objectContaining({
      username: 'alice',
      timeMs: 1234,
      text: 'hello world',
      mode: 1,
      color: '#abcdef',
    }),
  );
  expect(consumeSharedQuota).toHaveBeenCalledWith(
    {},
    'user-danmaku-send:alice',
    1,
    10,
    429,
  );
  expect((await response.json()).item.mine).toBe(true);
});

test.each([
  { key: 'bad' },
  { text: '\u0000  ' },
  { text: 'a'.repeat(101) },
  { time: -1 },
  { time: 86400.001 },
  { time: '1' },
  { mode: 3 },
  { color: 'red' },
])('rejects invalid input %j', async (patch) => {
  expect(
    (await own.POST(request('POST', '', { ...valid, ...patch }))).status,
  ).toBe(400);
  expect(db.addUserDanmaku).not.toHaveBeenCalled();
});

test('bounds streamed request bytes and rejects cross-origin writes', async () => {
  expect(
    (await own.POST(request('POST', '', { ...valid, text: 'x'.repeat(17000) })))
      .status,
  ).toBe(413);
  expect(
    (
      await own.POST(
        request('POST', '', valid, { origin: 'http://localhost:3000' }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await own.POST(
        request('POST', '', valid, { 'sec-fetch-site': 'cross-site' }),
      )
    ).status,
  ).toBe(403);
  const broken = new NextRequest('https://icetv.test/api/danmaku/user', {
    method: 'POST',
    body: '{',
  });
  expect((await own.POST(broken)).status).toBe(400);
});

test('returns rate limit and retry delay without a write', async () => {
  jest
    .mocked(consumeSharedQuota)
    .mockRejectedValue(new ResourceLimitError(429, 12.2));
  const response = await own.POST(request('POST', '', valid));
  expect(response.status).toBe(429);
  expect(response.headers.get('Retry-After')).toBe('13');
  expect(await response.json()).toEqual({ error: '发送太频繁，请稍后再试' });
  expect(db.addUserDanmaku).not.toHaveBeenCalled();
});

test('returns 404 for missing or another user item', async () => {
  jest.mocked(db.deleteUserDanmaku).mockResolvedValue(false);
  expect(
    (await own.DELETE(request('DELETE', `?id=${userDanmaku.id}`))).status,
  ).toBe(404);
  expect(db.deleteUserDanmaku).toHaveBeenCalledWith(userDanmaku.id, 'alice');
});

test('admin cursor page returns seconds and accepts next cursor', async () => {
  jest.mocked(db.getUserDanmakuPage).mockResolvedValue(
    Array.from({ length: 51 }, (_, i) => ({
      ...userDanmaku,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    })),
  );
  const response = await admin.GET(request('GET', '?q=alice'));
  const page = await response.json();
  expect(page.items).toHaveLength(50);
  expect(page.items[0].time).toBe(1.234);
  expect(page.items[0].timeMs).toBeUndefined();
  await admin.GET(request('GET', `?cursor=${page.nextCursor}`));
  expect(db.getUserDanmakuPage).toHaveBeenLastCalledWith({
    q: '',
    cursor: { createdAt: 1000, id: page.items[49].id },
  });
  expect((await admin.GET(request('GET', '?cursor=bad'))).status).toBe(400);
});

test('admin validates and deduplicates bounded bulk deletion', async () => {
  const response = await admin.DELETE(
    request('DELETE', '', { ids: [userDanmaku.id, userDanmaku.id] }),
  );
  expect(await response.json()).toEqual({ deleted: 1 });
  expect(db.deleteUserDanmakuBatch).toHaveBeenCalledWith([userDanmaku.id]);
  for (const ids of [[], ['invalid'], Array(101).fill(userDanmaku.id)]) {
    expect((await admin.DELETE(request('DELETE', '', { ids }))).status).toBe(
      400,
    );
  }
});

test('unexpected failures expose only display-safe text', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest
    .mocked(db.getUserDanmaku)
    .mockRejectedValue(new Error('database secret'));
  const response = await own.GET(request('GET', '?key=dandan:123'));
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('secret');
  log.mockRestore();
});
