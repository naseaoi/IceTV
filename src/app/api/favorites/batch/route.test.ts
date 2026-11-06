/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();
const mockBatchFavorites = jest.fn();
const mockGuard = jest.fn().mockResolvedValue({ username: 'demo' });
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: (...args: unknown[]) => mockGuard(...args),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/db', () => ({
  db: { batchFavorites: (...args: unknown[]) => mockBatchFavorites(...args) },
}));
const { POST } = require('./route') as typeof import('./route');
const request = (body: unknown) => ({ json: async () => body }) as NextRequest;
beforeEach(() => {
  jest.clearAllMocks();
  mockGuard.mockResolvedValue({ username: 'demo' });
});

it.each([
  {
    action: 'set-status',
    target: { keys: ['source+1'] },
    watchStatus: 'completed',
  },
  { action: 'set-status', target: { keys: ['source+1'] }, watchStatus: null },
  {
    action: 'remove',
    target: { match: { q: 'Demo', filter: 'planned' }, exclude: ['source+2'] },
  },
])('转发已验证操作并返回影响数量 %j', async (body) => {
  mockBatchFavorites.mockResolvedValue({ affected: 1 });
  const response = await POST(request(body));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ affected: 1 });
  expect(mockBatchFavorites).toHaveBeenCalledWith('demo', body);
});

it('拒绝超限选择并保持存储不变', async () => {
  const response = await POST(
    request({
      action: 'remove',
      target: { keys: Array(501).fill('source+1') },
    }),
  );
  expect(response.status).toBe(400);
  expect(mockBatchFavorites).not.toHaveBeenCalled();
});

it('未登录请求在读取正文前返回门禁响应', async () => {
  mockGuard.mockResolvedValue({
    response: new Response(null, { status: 401 }),
  });
  expect((await POST(request(null))).status).toBe(401);
  expect(mockBatchFavorites).not.toHaveBeenCalled();
});
