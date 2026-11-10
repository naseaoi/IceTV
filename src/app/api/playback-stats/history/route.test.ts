/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
installWebPolyfills();
const mockPage = jest.fn();
const mockDelete = jest.fn();
const mockGuard = jest.fn();
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: (...args: unknown[]) => mockGuard(...args),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: async () => ({
    SiteConfig: { PlaybackHistoryPageSize: 2 },
  }),
}));
jest.mock('@/lib/db', () => ({
  db: {
    getWatchHistoryPage: (...args: unknown[]) => mockPage(...args),
    deleteWatchHistoryEntry: (...args: unknown[]) => mockDelete(...args),
  },
}));
const { GET, DELETE } = require('./route') as typeof import('./route');
const request = (query = '') =>
  new Request(
    `http://localhost/api/playback-stats/history${query}`,
  ) as unknown as NextRequest;
beforeEach(() => {
  jest.clearAllMocks();
  mockGuard.mockResolvedValue({ username: 'demo' });
  mockPage.mockResolvedValue([]);
});
it('SQL 查询请求多取一条并返回不透明双键游标，同名作品独立返回', async () => {
  const rows = [3, 2, 1].map((i) => ({
    id: `history_00${i}`,
    title: '同名',
    last_watched_at: 100,
  }));
  mockPage.mockResolvedValue(rows);
  const body = await (await GET(request('?limit=2&q=%20Show%20'))).json();
  expect(body.items).toEqual(rows.slice(0, 2));
  expect(typeof body.nextCursor).toBe('string');
  expect(mockPage).toHaveBeenCalledWith('demo', {
    limit: 3,
    keyword: 'Show',
    cursor: undefined,
  });
  mockPage.mockResolvedValue([rows[2]]);
  const next = await (await GET(request(`?cursor=${body.nextCursor}`))).json();
  expect(mockPage).toHaveBeenLastCalledWith('demo', {
    limit: 3,
    keyword: undefined,
    cursor: { lastWatchedAt: 100, id: 'history_002' },
  });
  expect(next.nextCursor).toBeNull();
});
it('拒绝非法游标并限制分页大小', async () => {
  expect((await GET(request('?cursor=not-json'))).status).toBe(400);
  expect(mockPage).not.toHaveBeenCalled();
  await GET(request('?limit=999999'));
  expect(mockPage.mock.calls[0][1].limit).toBe(3);
});
it('删除只调用当前用户的历史删除', async () => {
  expect((await DELETE(request('?id=history_001'))).status).toBe(200);
  expect(mockDelete).toHaveBeenCalledWith('demo', 'history_001');
  expect((await DELETE(request('?id=bad'))).status).toBe(400);
});
it('未登录请求在存储访问前终止', async () => {
  mockGuard.mockResolvedValue({
    response: new Response(null, { status: 401 }),
  });
  expect((await GET(request())).status).toBe(401);
  expect((await DELETE(request('?id=history_001'))).status).toBe(401);
  expect(mockPage).not.toHaveBeenCalled();
  expect(mockDelete).not.toHaveBeenCalled();
});
it('数据库异常返回通用错误', async () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockPage.mockRejectedValue(new Error('private SQL'));
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Internal Server Error' });
  error.mockRestore();
});
