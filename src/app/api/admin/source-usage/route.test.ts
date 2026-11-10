/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();
const mockGuard = jest.fn();
const mockUsage = jest.fn();
const mockConfig = jest.fn();
jest.mock('@/lib/api-auth', () => ({
  requireAdmin: (...args: unknown[]) => mockGuard(...args),
  isGuardFailure: (value: object) => 'response' in value,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: (...args: unknown[]) => mockConfig(...args),
}));
jest.mock('@/features/playback-stats/lib/source-usage.server', () => ({
  getPlaybackSourceUsage: (...args: unknown[]) => mockUsage(...args),
}));
const { GET } = require('./route') as typeof import('./route');
const request = (query = '') =>
  new Request(
    `http://localhost/api/admin/source-usage${query}`,
  ) as unknown as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  mockGuard.mockResolvedValue({ username: 'admin' });
  mockConfig.mockResolvedValue({
    SourceConfig: [{ key: 'a', name: 'Configured A' }],
  });
  mockUsage.mockResolvedValue([]);
});
it.each(['7', '30', '90'])(
  'accepts %s days and resolves names from configuration then sessions',
  async (days) => {
    mockUsage.mockResolvedValue([
      {
        source: 'a',
        sourceName: 'Old A',
        watchSeconds: 120,
        userCount: 2,
        workCount: 1,
      },
      {
        source: 'removed',
        sourceName: 'Latest removed',
        watchSeconds: 60,
        userCount: 1,
        workCount: 1,
      },
    ]);
    const response = await GET(request(`?days=${days}`));
    const body = await response.json();
    expect(body.days).toBe(Number(days));
    expect(
      body.items.map((item: { sourceName: string }) => item.sourceName),
    ).toEqual(['Configured A', 'Latest removed']);
    expect(mockUsage).toHaveBeenCalledWith(Number(days));
    expect(response.headers.get('cache-control')).toContain('no-store');
  },
);
it('defaults to 30 days', async () => {
  await GET(request());
  expect(mockUsage).toHaveBeenCalledWith(30);
});
it.each(['0', '31', '7.0', '', 'bad'])(
  'rejects invalid days %s',
  async (days) => {
    expect((await GET(request(`?days=${days}`))).status).toBe(400);
    expect(mockUsage).not.toHaveBeenCalled();
  },
);
it('enforces the administrator guard', async () => {
  const response = new Response('', { status: 403 });
  mockGuard.mockResolvedValue({ response });
  expect(await GET(request())).toBe(response);
  expect(mockUsage).not.toHaveBeenCalled();
});
it('returns a safe error on database failure', async () => {
  mockUsage.mockRejectedValue(new Error('database secret'));
  const log = jest.spyOn(console, 'error').mockImplementation();
  try {
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: '源使用统计暂不可用' });
  } finally {
    log.mockRestore();
  }
});
