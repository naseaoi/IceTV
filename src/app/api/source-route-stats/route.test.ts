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
const outcome = { source: 'a', success: true, eventAt };
const stat = { ...outcome, routeMode: 'browser' };
const request = (body: unknown) => ({ json: async () => body }) as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  (requireActiveUser as jest.Mock).mockResolvedValue({ username: 'alice' });
  (getAvailableApiSites as jest.Mock).mockResolvedValue([{ key: 'a' }]);
  (recordSourcePlayOutcome as jest.Mock).mockResolvedValue(undefined);
  (db.recordSourceRouteStat as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it('records route attempts without changing source health', async () => {
  expect((await POST(request({ stat }))).status).toBe(200);
  expect(db.recordSourceRouteStat).toHaveBeenCalledWith(stat);
  expect(recordSourcePlayOutcome).not.toHaveBeenCalled();
});

it('records the final play outcome without recording a route attempt', async () => {
  expect((await POST(request({ outcome }))).status).toBe(200);
  expect(recordSourcePlayOutcome).toHaveBeenCalledWith(
    'alice',
    'a',
    true,
    eventAt,
  );
  expect(db.recordSourceRouteStat).not.toHaveBeenCalled();
});

it('records both independently, including a failed attempt followed by final success', async () => {
  const response = await POST(
    request({ stat: { ...stat, success: false }, outcome }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(db.recordSourceRouteStat).toHaveBeenCalledWith({
    ...stat,
    success: false,
  });
  expect(recordSourcePlayOutcome).toHaveBeenCalledWith(
    'alice',
    'a',
    true,
    eventAt,
  );
});

it.each([
  {},
  null,
  [],
  { stat: null },
  { outcome: null },
  { stat, outcome: {} },
  { stat: { ...stat, routeMode: 'auto' } },
  { stat: { ...stat, routeMode: undefined } },
  { outcome: { ...outcome, success: 'true' } },
  { outcome: { ...outcome, eventAt: '123' } },
  { outcome: { ...outcome, eventAt: Number.NaN } },
  { outcome: { ...outcome, eventAt: 0 } },
  { outcome: { ...outcome, source: 'x'.repeat(192) } },
])('rejects invalid payloads before writing: %j', async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(db.recordSourceRouteStat).not.toHaveBeenCalled();
  expect(recordSourcePlayOutcome).not.toHaveBeenCalled();
});

it.each([
  { stat: { ...stat, source: 'hidden' } },
  { outcome: { ...outcome, source: 'hidden' } },
  { stat, outcome: { ...outcome, source: 'hidden' } },
  { stat: { ...stat, source: 'hidden' }, outcome },
])('checks access to every source before either write: %j', async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(db.recordSourceRouteStat).not.toHaveBeenCalled();
  expect(recordSourcePlayOutcome).not.toHaveBeenCalled();
});

it('rejects invalid JSON', async () => {
  const req = {
    json: async () => {
      throw new SyntaxError('invalid JSON');
    },
  } as unknown as NextRequest;
  expect((await POST(req)).status).toBe(400);
});

it('preserves the active-user guard', async () => {
  (requireActiveUser as jest.Mock).mockResolvedValue({
    response: new Response(null, { status: 401 }),
  });
  expect((await POST(request({ stat, outcome }))).status).toBe(401);
  expect(db.recordSourceRouteStat).not.toHaveBeenCalled();
  expect(recordSourcePlayOutcome).not.toHaveBeenCalled();
});

it('attempts the final outcome even when the route-stat write fails', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (db.recordSourceRouteStat as jest.Mock).mockRejectedValue(
    new Error('route unavailable'),
  );
  expect((await POST(request({ stat, outcome }))).status).toBe(500);
  expect(recordSourcePlayOutcome).toHaveBeenCalledWith(
    'alice',
    'a',
    true,
    eventAt,
  );
});

it('limits normalized usernames to 120 reports per minute before reading the body or writing', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-04T12:00:00Z'));
  try {
    (requireActiveUser as jest.Mock).mockResolvedValue({
      username: 'Rate-Limited',
    });
    for (let i = 0; i < 120; i++) {
      expect((await POST(request({ stat, outcome }))).status).toBe(200);
    }
    (requireActiveUser as jest.Mock).mockResolvedValue({
      username: ' rate-limited ',
    });
    const json = jest.fn().mockResolvedValue({ stat, outcome });
    const response = await POST({ json } as unknown as NextRequest);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(await response.json()).toEqual({
      error: '播放统计上报过于频繁，请稍后重试',
    });
    expect(json).not.toHaveBeenCalled();
    expect(db.recordSourceRouteStat).toHaveBeenCalledTimes(120);
    expect(recordSourcePlayOutcome).toHaveBeenCalledTimes(120);
    (requireActiveUser as jest.Mock).mockResolvedValue({
      username: 'another-user',
    });
    expect((await POST(request({ outcome }))).status).toBe(200);
    jest.advanceTimersByTime(60_000);
    (requireActiveUser as jest.Mock).mockResolvedValue({
      username: 'rate-limited',
    });
    expect((await POST(request({ outcome }))).status).toBe(200);
  } finally {
    jest.useRealTimers();
  }
});

it('returns a generic error when recording the final outcome fails', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (recordSourcePlayOutcome as jest.Mock).mockRejectedValue(
    new Error('sensitive error'),
  );
  const response = await POST(request({ outcome }));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: '保存播放统计失败' });
});
