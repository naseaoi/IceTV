/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();
const mockGuard = jest.fn();
const mockData = jest.fn();
const mockReviews = jest.fn();
const mockRetention = jest.fn();
const mockRecap = jest.fn();
const mockSaveRecap = jest.fn();
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: (...args: unknown[]) => mockGuard(...args),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/db', () => ({
  db: {
    getAnnualRecap: (...args: unknown[]) => mockRecap(...args),
    saveAnnualRecap: (...args: unknown[]) => mockSaveRecap(...args),
    getPlaybackAnnualData: (...args: unknown[]) => mockData(...args),
    getAllVideoReviews: (...args: unknown[]) => mockReviews(...args),
  },
}));
jest.mock('@/lib/cron/playback-retention', () => ({
  readPlaybackStatsRetentionDays: () => mockRetention(),
}));
const { GET } = require('./route') as typeof import('./route');
const request = (query = '') =>
  new Request(
    `http://localhost/api/playback-stats/annual${query}`,
  ) as unknown as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2025-12-31T20:00:00Z'));
  mockGuard.mockResolvedValue({ username: 'demo', role: 'user' });
  mockData.mockResolvedValue({
    sessions: [],
    buckets: [],
    earliestStartedAt: null,
  });
  mockReviews.mockResolvedValue([]);
  mockRetention.mockReturnValue(0);
  mockRecap.mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

it.each([
  '?year=',
  '?year=1999',
  '?year=2027',
  '?year=2025.5',
  '?year=2e3',
  '?year=2025x',
  '?year=-1',
  '?tz=',
  '?tz=invalid',
])('rejects invalid parameters %s', async (query) => {
  const response = await GET(request(query));
  expect(response.status).toBe(400);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(mockData).not.toHaveBeenCalled();
});
it('guards reads before parsing query parameters', async () => {
  const response = new Response('Unauthorized', { status: 401 });
  mockGuard.mockResolvedValue({ response });
  expect(await GET(request('?year=invalid'))).toBe(response);
  expect(mockData).not.toHaveBeenCalled();
  expect(mockReviews).not.toHaveBeenCalled();
});
it('defaults to the current year in the requested timezone for preview', async () => {
  mockGuard.mockResolvedValue({ username: 'demo', role: 'owner' });
  const response = await GET(request('?tz=Asia%2FShanghai'));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toMatchObject({
    year: 2026,
    timeZone: 'Asia/Shanghai',
    inProgress: true,
  });
  expect(mockData).toHaveBeenCalledWith(
    'demo',
    Date.parse('2025-12-31T16:00:00Z'),
    Date.parse('2026-12-31T16:00:00Z'),
  );
  expect(mockReviews).toHaveBeenCalledWith('demo');
});
it('validates future years against local rather than UTC year', async () => {
  mockGuard.mockResolvedValue({ username: 'demo', role: 'admin' });
  expect((await GET(request('?year=2026&tz=Asia%2FShanghai'))).status).toBe(
    200,
  );
  expect((await GET(request('?year=2026&tz=America%2FNew_York'))).status).toBe(
    400,
  );
});
it('supports historical years and retention metadata', async () => {
  mockRetention.mockReturnValue(365);
  const response = await GET(request('?year=2024'));
  expect(await response.json()).toMatchObject({
    year: 2024,
    timeZone: 'UTC',
    inProgress: false,
    possiblyIncomplete: true,
  });
  expect(mockData).toHaveBeenCalledWith(
    'demo',
    Date.parse('2024-01-01T00:00:00Z'),
    Date.parse('2025-01-01T00:00:00Z'),
  );
});
it('returns a safe no-store failure without database details', async () => {
  mockData.mockRejectedValue(new Error('private database details'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({ error: '获取年度观看报告失败' });
});

it('blocks unreleased reports before storage reads and opens at local midnight', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-19T16:00:00Z'));
  const blocked = await GET(request('?year=2026&tz=UTC'));
  expect(blocked.status).toBe(403);
  expect(blocked.headers.get('cache-control')).toContain('no-store');
  expect(await blocked.json()).toEqual({
    error: '2026 年度报告将于 12 月 20 日开放',
  });
  expect(mockData).not.toHaveBeenCalled();
  expect(mockReviews).not.toHaveBeenCalled();
  expect((await GET(request('?year=2026&tz=Asia%2FShanghai'))).status).toBe(
    200,
  );
});

it.each(['owner', 'admin'])(
  'allows %s preview with unreleased available years',
  async (role) => {
    mockGuard.mockResolvedValue({ username: 'demo', role });
    const result = await (
      await GET(request('?year=2025&tz=Asia%2FShanghai'))
    ).json();
    expect(result.availableYears).toEqual([2026, 2025]);
  },
);

it('filters unreleased years while retaining historical access after the window closes', async () => {
  const result = await (
    await GET(request('?year=2025&tz=Asia%2FShanghai'))
  ).json();
  expect(result.availableYears).toEqual([2025]);
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-01T00:00:00Z'));
  expect((await GET(request('?year=2025'))).status).toBe(200);
});

it('refreshes an existing released snapshot with its privacy and identity guard', async () => {
  mockRecap.mockResolvedValue({
    hideRhythm: true,
    publishedAt: 100,
    updatedAt: 200,
  });
  expect((await GET(request('?year=2025'))).status).toBe(200);
  expect(mockSaveRecap).toHaveBeenCalledWith(
    'demo',
    expect.objectContaining({ rhythmHidden: true, latestNight: null }),
    expect.any(Number),
    { publishedAt: 100, updatedAt: 200 },
  );
});
