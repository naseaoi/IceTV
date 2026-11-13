/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
installWebPolyfills();
const mockGuard = jest.fn();
const mockRead = jest.fn();
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: (...args: unknown[]) => mockGuard(...args),
  isGuardFailure: (value: object) => 'response' in value,
}));
jest.mock('@/lib/db', () => ({
  db: { getWatchLevel: (...args: unknown[]) => mockRead(...args) },
}));
const { GET } = require('./route') as typeof import('./route');
const request = {} as NextRequest;
beforeEach(() => {
  jest.clearAllMocks();
  mockGuard.mockResolvedValue({ username: 'alice' });
});
it('仅读取当前账号，返回等级、毫秒与足迹，禁用缓存', async () => {
  const body = {
    level: 2,
    countedMs: 7200000,
    events: [
      {
        level: 2,
        reachedAt: 100,
        title: '作品',
        year: '2026',
        episodeIndex: 1,
        source: 's',
        videoId: 'v',
      },
    ],
  };
  mockRead.mockResolvedValue(body);
  const response = await GET(request);
  expect(await response.json()).toEqual(body);
  expect(mockRead).toHaveBeenCalledWith('alice');
  expect(response.headers.get('cache-control')).toContain('no-store');
});
it('未登录与封禁请求原样返回门禁响应', async () => {
  for (const status of [401, 403]) {
    mockGuard.mockResolvedValue({ response: new Response(null, { status }) });
    expect((await GET(request)).status).toBe(status);
  }
  expect(mockRead).not.toHaveBeenCalled();
});
it('存储异常保持通用提示', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockRead.mockRejectedValue(new Error('private SQL'));
  const response = await GET(request);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: '读取观影等级失败' });
  log.mockRestore();
});
