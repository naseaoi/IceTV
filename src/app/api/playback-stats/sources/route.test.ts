/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();
const mockGuard = jest.fn();
const mockUsage = jest.fn();
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: (...args: unknown[]) => mockGuard(...args),
  isGuardFailure: (value: object) => 'response' in value,
}));
jest.mock('@/features/playback-stats/lib/source-usage.server', () => ({
  getPlaybackSourceUsage: (...args: unknown[]) => mockUsage(...args),
}));
const { GET } = require('./route') as typeof import('./route');
const request = () =>
  new Request(
    'http://localhost/api/playback-stats/sources',
  ) as unknown as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  mockGuard.mockResolvedValue({ username: 'demo' });
});
it('returns only personal source durations for the last 90 days', async () => {
  mockUsage.mockResolvedValue([
    {
      source: 'a',
      sourceName: 'A',
      watchSeconds: 120,
      userCount: 1,
      workCount: 2,
    },
  ]);
  const response = await GET(request());
  expect(await response.json()).toEqual({
    sources: [{ source: 'a', watchSeconds: 120 }],
  });
  expect(mockUsage).toHaveBeenCalledWith(90, 'demo');
  expect(response.headers.get('cache-control')).toContain('no-store');
});
it('returns authentication failures without querying usage', async () => {
  const response = new Response('', { status: 401 });
  mockGuard.mockResolvedValue({ response });
  expect(await GET(request())).toBe(response);
  expect(mockUsage).not.toHaveBeenCalled();
});
it('keeps storage errors private', async () => {
  mockUsage.mockRejectedValue(new Error('database secret'));
  const log = jest.spyOn(console, 'error').mockImplementation();
  try {
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: '观看统计暂不可用' });
  } finally {
    log.mockRestore();
  }
});
