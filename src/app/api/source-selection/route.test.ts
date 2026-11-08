/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { getSourceHealthTiers } from '@/lib/source-health.server';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn(),
  getAvailableApiSites: jest.fn(),
}));
jest.mock('@/lib/source-health.server', () => ({
  getSourceHealthTiers: jest.fn(),
}));
installWebPolyfills();
const { GET } = require('./route') as typeof import('./route');

beforeEach(() => {
  jest.clearAllMocks();
  (requireActiveUser as jest.Mock).mockResolvedValue({ username: 'alice' });
  (getConfigForRead as jest.Mock).mockResolvedValue({});
  (getAvailableApiSites as jest.Mock).mockResolvedValue([
    { key: 'visible' },
    { key: 'unknown' },
  ]);
  (getSourceHealthTiers as jest.Mock).mockResolvedValue(
    new Map([
      ['visible', 'good'],
      ['hidden', 'poor'],
    ]),
  );
});

it('returns only allowed source tiers without scores or changing source order', async () => {
  const response = await GET({} as NextRequest);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ visible: 'good' });
});

it('requires an active session', async () => {
  const denied = new Response(null, { status: 401 });
  (requireActiveUser as jest.Mock).mockResolvedValue({ response: denied });
  expect(await GET({} as NextRequest)).toBe(denied);
  expect(getSourceHealthTiers).not.toHaveBeenCalled();
});

it('returns a generic failure without exposing the underlying error', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  (getConfigForRead as jest.Mock).mockRejectedValueOnce(
    new Error('private database error'),
  );
  const response = await GET({} as NextRequest);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: '播放源等级暂不可用' });
  log.mockRestore();
});
