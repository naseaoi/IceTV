/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireAdmin } from '@/lib/api-auth';
import { getSourceHealthReport } from '@/lib/source-health.server';

jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn(),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/source-health.server', () => ({
  getSourceHealthReport: jest.fn(),
}));
installWebPolyfills();
const { GET } = require('./route') as typeof import('./route');
const request = (query = '') =>
  ({
    nextUrl: new URL(`http://localhost/api/admin/source-health${query}`),
  }) as NextRequest;

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ username: 'admin' });
  (getSourceHealthReport as jest.Mock).mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

it.each([
  ['', 7],
  ['?days=1', 1],
  ['?days=30', 30],
  ['?days=0', 1],
  ['?days=100', 30],
  ['?days=invalid', 7],
  ['?days=2.9', 2],
])(
  'normalizes %s to %s days and disables response caching',
  async (query, days) => {
    const response = await GET(request(query));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ days, items: [] });
    expect(getSourceHealthReport).toHaveBeenCalledWith(days);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  },
);

it.each([401, 403])(
  'returns the admin guard failure %s before reading data',
  async (status) => {
    const denied = Response.json({ error: 'denied' }, { status });
    (requireAdmin as jest.Mock).mockResolvedValue({ response: denied });
    expect(await GET(request())).toBe(denied);
    expect(getSourceHealthReport).not.toHaveBeenCalled();
  },
);

it('returns items unchanged', async () => {
  const items = [{ source: 'a', tier: 'offline', score: 8 }];
  (getSourceHealthReport as jest.Mock).mockResolvedValue(items);
  expect(await (await GET(request())).json()).toEqual({ days: 7, items });
});

it('logs internal failures and returns a generic non-cacheable error', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  (getSourceHealthReport as jest.Mock).mockRejectedValue(
    new Error('secret db error'),
  );
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Internal Server Error' });
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(log).toHaveBeenCalled();
});
