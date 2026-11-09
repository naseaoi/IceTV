/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';

jest.mock('@/lib/api-auth', () => ({
  requireAdmin: jest.fn(),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/db', () => ({ db: { getSourceRouteStats: jest.fn() } }));
installWebPolyfills();
const { GET } = require('./route') as typeof import('./route');

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ username: 'admin' });
});
afterEach(() => jest.restoreAllMocks());

it('returns the route-stat payload from current-semantics storage', async () => {
  const stats = [
    { source: 'a', routeMode: 'browser', successCount: 3, failureCount: 1 },
  ];
  (db.getSourceRouteStats as jest.Mock).mockResolvedValue(stats);
  const response = await GET({
    nextUrl: new URL('http://localhost/api/admin/source-route-stats?days=7'),
  } as NextRequest);
  expect(await response.json()).toEqual({ days: 7, stats });
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(db.getSourceRouteStats).toHaveBeenCalledTimes(1);
});

it('requires an admin before reading stats', async () => {
  (requireAdmin as jest.Mock).mockResolvedValue({
    response: new Response(null, { status: 403 }),
  });
  expect((await GET({} as NextRequest)).status).toBe(403);
  expect(db.getSourceRouteStats).not.toHaveBeenCalled();
});
