/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites } from '@/lib/config';
import { db } from '@/lib/db';
import { recordSourcePlayOutcome } from '@/lib/source-health.server';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn().mockResolvedValue({}),
  getAvailableApiSites: jest.fn(),
}));
jest.mock('@/lib/db', () => ({ db: { recordSourceRouteStat: jest.fn() } }));
jest.mock('@/lib/source-health.server', () => ({
  recordSourcePlayOutcome: jest.fn(),
}));
installWebPolyfills();
const { POST } = require('./route') as typeof import('./route');
const eventAt = Date.parse('2026-01-01T00:00:00Z');
const request = () =>
  ({
    json: async () => ({ stat: { source: 'a', success: true, eventAt } }),
  }) as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  (requireActiveUser as jest.Mock).mockResolvedValue({ username: 'alice' });
  (getAvailableApiSites as jest.Mock).mockResolvedValue([{ key: 'a' }]);
  (recordSourcePlayOutcome as jest.Mock).mockResolvedValue(undefined);
  (db.recordSourceRouteStat as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it('records play health after route statistics using the authenticated username', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(recordSourcePlayOutcome).toHaveBeenCalledWith(
    'alice',
    'a',
    true,
    eventAt,
  );
  expect(
    (db.recordSourceRouteStat as jest.Mock).mock.invocationCallOrder[0],
  ).toBeLessThan(
    (recordSourcePlayOutcome as jest.Mock).mock.invocationCallOrder[0],
  );
});

it('preserves successful responses when the supplementary health write fails', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  (recordSourcePlayOutcome as jest.Mock).mockRejectedValue(
    new Error('health unavailable'),
  );
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
  expect(warn).toHaveBeenCalledTimes(1);
});

it('does not report health if the original write fails', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (db.recordSourceRouteStat as jest.Mock).mockRejectedValue(
    new Error('route unavailable'),
  );
  expect((await POST(request())).status).toBe(500);
  expect(recordSourcePlayOutcome).not.toHaveBeenCalled();
});

it('rejects unavailable sources before either write', async () => {
  (getAvailableApiSites as jest.Mock).mockResolvedValue([]);
  expect((await POST(request())).status).toBe(400);
  expect(db.recordSourceRouteStat).not.toHaveBeenCalled();
  expect(recordSourcePlayOutcome).not.toHaveBeenCalled();
});
