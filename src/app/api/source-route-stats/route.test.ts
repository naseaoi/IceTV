/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites } from '@/lib/config';
import { db } from '@/lib/db';
import {
  recordSourcePlayOutcome,
  recordSourceSmoothness,
} from '@/lib/source-health.server';

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
  recordSourceSmoothness: jest.fn(),
}));
installWebPolyfills();
const { POST } = require('./route') as typeof import('./route');
const eventAt = Date.parse('2026-01-01T00:00:00Z');
const outcome = { source: 'a', success: true, eventAt };
const stat = { ...outcome, routeMode: 'browser', phase: 'primary' };
const request = (body: unknown) => ({ json: async () => body }) as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  (requireActiveUser as jest.Mock).mockResolvedValue({ username: 'alice' });
  (getAvailableApiSites as jest.Mock).mockResolvedValue([{ key: 'a' }]);
  (recordSourcePlayOutcome as jest.Mock).mockResolvedValue(undefined);
  (recordSourceSmoothness as jest.Mock).mockResolvedValue(undefined);
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
  { stat: { ...stat, phase: null }, outcome },
  { stat: { ...stat, phase: 'invalid' }, outcome },
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

it('ignores phase-less legacy stats and preserves their final outcome', async () => {
  const legacyStat = { ...outcome, routeMode: 'server' };
  expect((await POST(request({ stat: legacyStat, outcome }))).status).toBe(200);
  expect(db.recordSourceRouteStat).not.toHaveBeenCalled();
  expect(recordSourcePlayOutcome).toHaveBeenCalledWith(
    'alice',
    'a',
    true,
    eventAt,
  );
  expect((await POST(request({ stat: legacyStat }))).status).toBe(200);
});

const smooth = {
  source: 'a',
  routeMode: 'browser',
  mediaType: 'hls',
  watchMs: 300_000,
  stallMs: 2000,
  stallCount: 1,
  unknownMs: 500,
  eventAt,
};

it.each([false, true])(
  'records smoothness alone or with other stats: combined=%s',
  async (combined) => {
    const response = await POST(
      request({ ...(combined ? { stat, outcome } : {}), smooth }),
    );
    expect(response.status).toBe(200);
    expect(recordSourceSmoothness).toHaveBeenCalledWith('alice', smooth);
    expect(db.recordSourceRouteStat).toHaveBeenCalledTimes(combined ? 1 : 0);
    expect(recordSourcePlayOutcome).toHaveBeenCalledTimes(combined ? 1 : 0);
  },
);

it('normalizes source, integer increments and future timestamps like outcomes', async () => {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  expect(
    (
      await POST(
        request({
          smooth: {
            ...smooth,
            source: ' a ',
            routeMode: 'server',
            mediaType: 'mp4',
            watchMs: 100.9,
            stallMs: 10.9,
            stallCount: 2.9,
            unknownMs: 5.9,
            eventAt: now + 100_000,
          },
        }),
      )
    ).status,
  ).toBe(200);
  expect(recordSourceSmoothness).toHaveBeenCalledWith('alice', {
    ...smooth,
    routeMode: 'server',
    mediaType: 'mp4',
    watchMs: 100,
    stallMs: 10,
    stallCount: 2,
    unknownMs: 5,
    eventAt: now + 60_000,
  });
});

it('ignores all-zero smooth increments while retaining outcomes', async () => {
  const zero = {
    ...smooth,
    watchMs: 0,
    stallMs: 0,
    stallCount: 0,
    unknownMs: 0,
  };
  expect((await POST(request({ smooth: zero }))).status).toBe(200);
  expect((await POST(request({ smooth: zero, outcome }))).status).toBe(200);
  expect(recordSourceSmoothness).not.toHaveBeenCalled();
  expect(recordSourcePlayOutcome).toHaveBeenCalledTimes(1);
});

it.each([
  null,
  {},
  [],
  { ...smooth, source: '' },
  { ...smooth, source: 'x'.repeat(192) },
  { ...smooth, routeMode: 'auto' },
  { ...smooth, mediaType: 'dash' },
  { ...smooth, watchMs: -1 },
  { ...smooth, watchMs: 600_001 },
  { ...smooth, watchMs: Infinity },
  { ...smooth, watchMs: '1' },
  { ...smooth, stallMs: -1 },
  { ...smooth, stallMs: 330_001 },
  { ...smooth, stallMs: NaN },
  { ...smooth, stallMs: '1' },
  { ...smooth, unknownMs: -1 },
  { ...smooth, unknownMs: 330_001 },
  { ...smooth, unknownMs: Infinity },
  { ...smooth, unknownMs: null },
  { ...smooth, stallCount: -1 },
  { ...smooth, stallCount: 121 },
  { ...smooth, stallCount: NaN },
  { ...smooth, stallCount: undefined },
  { ...smooth, eventAt: 0 },
  { ...smooth, eventAt: Infinity },
  { ...smooth, eventAt: '1' },
])('rejects malformed smoothness before any write: %j', async (invalid) => {
  const response = await POST(request({ smooth: invalid, stat, outcome }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: '播放统计格式无效' });
  expect(recordSourceSmoothness).not.toHaveBeenCalled();
  expect(recordSourcePlayOutcome).not.toHaveBeenCalled();
  expect(db.recordSourceRouteStat).not.toHaveBeenCalled();
});

it('accepts exact smoothness limits and unknown-only diagnostics', async () => {
  expect(
    (
      await POST(
        request({
          smooth: {
            ...smooth,
            watchMs: 600_000,
            stallMs: 630_000,
            unknownMs: 630_000,
            stallCount: 120,
          },
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await POST(
        request({
          smooth: { ...smooth, watchMs: 0, stallMs: 0, stallCount: 0 },
        }),
      )
    ).status,
  ).toBe(200);
  expect(recordSourceSmoothness).toHaveBeenCalledTimes(2);
});

it('checks smoothness source access even for zero increments', async () => {
  expect(
    (
      await POST(
        request({
          smooth: {
            ...smooth,
            source: 'hidden',
            watchMs: 0,
            stallMs: 0,
            stallCount: 0,
            unknownMs: 0,
          },
          outcome,
        }),
      )
    ).status,
  ).toBe(400);
  expect(recordSourceSmoothness).not.toHaveBeenCalled();
  expect(recordSourcePlayOutcome).not.toHaveBeenCalled();
});

it('returns a generic error on smoothness storage failure', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (recordSourceSmoothness as jest.Mock).mockRejectedValue(
    new Error('sensitive database details'),
  );
  const response = await POST(request({ smooth }));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: '保存播放统计失败' });
});

it('records fallback attempts separately', async () => {
  const fallback = { ...stat, routeMode: 'server', phase: 'fallback' };
  expect((await POST(request({ stat: fallback }))).status).toBe(200);
  expect(db.recordSourceRouteStat).toHaveBeenCalledWith(fallback);
});
