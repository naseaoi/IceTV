/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockGuard = jest.fn();
const mockSessions = jest.fn();
const mockTotals = jest.fn();
const mockAnnual = jest.fn();

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: (...args: unknown[]) => mockGuard(...args),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/db', () => ({
  db: {
    getPlaybackAnnualData: (...args: unknown[]) => mockAnnual(...args),
    getPlaybackPeriodSessions: (...args: unknown[]) => mockSessions(...args),
    getPlaybackWatchTotals: (...args: unknown[]) => mockTotals(...args),
  },
}));

const { GET } = require('./route') as typeof import('./route');
const request = (query = '') =>
  new Request(
    `http://localhost/api/playback-stats/period${query}`,
  ) as unknown as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  mockGuard.mockResolvedValue({
    username: 'demo',
    role: 'user',
    isOwner: false,
  });
  mockSessions.mockResolvedValue([]);
  mockAnnual.mockResolvedValue({
    sessions: [],
    buckets: [],
    earliestStartedAt: null,
  });
  mockTotals.mockResolvedValue({
    totalWatchSeconds: 120,
    periodWatchSeconds: 60,
  });
});

it.each([
  '?type=all',
  '?type=',
  '?tz=invalid',
  '?tz=',
  '?date=2026-2-03',
  '?date=2026-02-30',
  '?date=invalid',
  '?date=',
])('rejects invalid parameters %s', async (query) => {
  const response = await GET(request(query));
  expect(response.status).toBe(400);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(mockSessions).not.toHaveBeenCalled();
});

it('returns the auth guard response before reading stats', async () => {
  const denied = new Response('Unauthorized', { status: 401 });
  mockGuard.mockResolvedValue({ response: denied });
  expect(await GET(request())).toBe(denied);
  expect(mockSessions).not.toHaveBeenCalled();
  expect(mockTotals).not.toHaveBeenCalled();
});

it('returns the calendar period contract and reads the exact storage range', async () => {
  mockSessions.mockResolvedValue([
    {
      source: 'a',
      video_id: 'one',
      episode_index: 1,
      title: 'Show',
      cover: '',
      year: '2026',
      started_at: Date.parse('2026-11-02T17:00:00Z'),
      ended_at: Date.parse('2026-11-02T18:00:00Z'),
      watch_seconds: 60,
    },
  ]);
  const response = await GET(
    request('?type=week&date=2026-11-03&tz=Asia%2FShanghai'),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const body = await response.json();
  expect(body).toMatchObject({
    type: 'week',
    date: '2026-11-03',
    timeZone: 'Asia/Shanghai',
    start: Date.parse('2026-11-01T16:00:00Z'),
    end: Date.parse('2026-11-08T16:00:00Z'),
    watchSeconds: 60,
    activeDays: 1,
    lifetimeWatchSeconds: 120,
  });
  expect(body.buckets).toHaveLength(7);
  expect(body.buckets[1]).toMatchObject({
    key: '2026-11-03',
    watchSeconds: 60,
  });
  expect(body.topWorks).toEqual([
    {
      source: 'a',
      videoId: 'one',
      title: 'Show',
      cover: '',
      year: '2026',
      watchSeconds: 60,
      sessionCount: 1,
      episodeCount: 1,
      lastWatchedAt: Date.parse('2026-11-02T18:00:00Z'),
    },
  ]);
  expect(mockSessions).toHaveBeenCalledWith('demo', body.start, body.end);
  expect(mockTotals).toHaveBeenCalledWith('demo', body.start);
});

it('defaults to the current week in UTC', async () => {
  const now = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-11-03T00:00:00Z'));
  try {
    expect(await (await GET(request())).json()).toMatchObject({
      type: 'week',
      date: '2026-11-03',
      timeZone: 'UTC',
      watchSeconds: 0,
      activeDays: 0,
      topWorks: [],
    });
  } finally {
    now.mockRestore();
  }
});

it('supports monthly and annual reports', async () => {
  for (const [type, count] of [
    ['month', 30],
    ['year', 12],
  ]) {
    const response = await GET(request(`?type=${type}&date=2026-11-03`));
    expect(response.status).toBe(200);
    expect((await response.json()).buckets).toHaveLength(Number(count));
  }
});

it('returns a safe no-store error on database failure', async () => {
  mockSessions.mockRejectedValue(new Error('private database details'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ error: '获取播放统计失败' });
  } finally {
    log.mockRestore();
  }
});
