/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import type { VideoReview } from '@/lib/types';

installWebPolyfills();
const mockGuard = jest.fn();
const mockData = jest.fn();
const mockReviews = jest.fn();
const mockRecap = jest.fn();
const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockProfile = jest.fn();
const mockYears = jest.fn();
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: (...args: unknown[]) => mockGuard(...args),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/db', () => ({
  db: {
    getPlaybackAnnualData: (...args: unknown[]) => mockData(...args),
    getAllVideoReviews: (...args: unknown[]) => mockReviews(...args),
    getAnnualRecap: (...args: unknown[]) => mockRecap(...args),
    saveAnnualRecap: (...args: unknown[]) => mockSave(...args),
    deleteAnnualRecap: (...args: unknown[]) => mockDelete(...args),
    ensureUserProfile: jest.fn(),
    getUserProfileById: (...args: unknown[]) => mockProfile(...args),
    getAnnualRecapYears: (...args: unknown[]) => mockYears(...args),
  },
}));
jest.mock('@/lib/cron/playback-retention', () => ({
  readPlaybackStatsRetentionDays: () => 0,
}));
const { GET, PUT, DELETE } = require('./route') as typeof import('./route');
const { GET: publicGet } =
  require('@/app/api/users/[profileId]/recaps/[year]/route') as typeof import('@/app/api/users/[profileId]/recaps/[year]/route');
const request = (method: string, body?: unknown, query = '?year=2025') =>
  ({
    url: `http://localhost/api/playback-stats/annual/share${query}`,
    method,
    json: async () => body,
  }) as NextRequest;
const review = (is_public: boolean, rating: number): VideoReview => ({
  title: is_public ? '公开作品' : '私密作品',
  title_norm: 'work',
  year: '',
  cover: '',
  rating,
  douban_id: 0,
  source_key: '',
  content: '',
  is_public,
  created_at: Date.parse('2025-02-01T00:00:00Z'),
  updated_at: 0,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2025-12-20T00:00:00Z'));
  mockGuard.mockResolvedValue({ username: 'private-login', role: 'user' });
  mockData.mockResolvedValue({
    earliestStartedAt: null,
    buckets: [],
    sessions: [
      {
        id: 's',
        source: 'source',
        video_id: 'v',
        episode_index: 1,
        title: '影片',
        year: '',
        cover: '/cover.jpg',
        source_name: '源',
        started_at: Date.parse('2025-01-01T01:00:00Z'),
        ended_at: Date.parse('2025-01-01T01:01:00Z'),
        watch_seconds: 60,
        measurement_version: 1,
      },
    ],
  });
  mockReviews.mockResolvedValue([review(true, 8), review(false, 10)]);
  mockRecap.mockResolvedValue(null);
  mockSave.mockResolvedValue(undefined);
  mockProfile.mockResolvedValue({
    username: 'private-login',
    profile_id: 'AbCdEf012345',
    nickname: '昵称',
    avatar_seed: null,
  });
  mockYears.mockResolvedValue([2025]);
});
afterEach(() => jest.restoreAllMocks());

it.each([GET, PUT, DELETE])('guards every share method', async (handler) => {
  const response = new Response('', { status: 401 });
  mockGuard.mockResolvedValue({ response });
  expect(await handler(request('GET'))).toBe(response);
});
it('returns share state and deletes only the selected year', async () => {
  expect(await (await GET(request('GET'))).json()).toEqual({
    year: 2025,
    published: false,
    hideRhythm: false,
    publishedAt: null,
    updatedAt: null,
  });
  expect((await DELETE(request('DELETE'))).status).toBe(200);
  expect(mockDelete).toHaveBeenCalledWith('private-login', 2025);
});
it('writes only public review aggregates and removes rhythm and private year availability', async () => {
  expect(
    (await PUT(request('PUT', { year: 2025, tz: 'UTC', hideRhythm: true })))
      .status,
  ).toBe(200);
  const report = mockSave.mock.calls[0][1];
  expect(report).toMatchObject({
    rhythmHidden: true,
    lateNightWatchSeconds: 0,
    latestNight: null,
    reviews: {
      count: 1,
      ratedCount: 1,
      averageRating: 8,
      topRated: { title: '公开作品', rating: 8 },
    },
  });
  expect(report.hours).toEqual(Array(24).fill(0));
  expect(report.weekdays).toEqual(Array(7).fill(0));
  expect(report).not.toHaveProperty('availableYears');
  expect(JSON.stringify(report)).not.toContain('私密作品');
  expect(JSON.stringify(report)).not.toContain('private-login');
});
it.each(['owner', 'admin', 'user'])(
  'requires release in the requested local date for %s',
  async (role) => {
    mockGuard.mockResolvedValue({ username: 'private-login', role });
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2025-12-19T16:00:00Z'));
    expect(
      (await PUT(request('PUT', { year: 2025, tz: 'UTC', hideRhythm: false })))
        .status,
    ).toBe(403);
    expect(mockData).not.toHaveBeenCalled();
    expect(
      (
        await PUT(
          request('PUT', {
            year: 2025,
            tz: 'Asia/Shanghai',
            hideRhythm: false,
          }),
        )
      ).status,
    ).toBe(200);
  },
);
it.each([
  { year: 2025, tz: 'invalid', hideRhythm: false },
  { year: 2025, tz: 'UTC', hideRhythm: 'true' },
  { year: 2025.5, tz: 'UTC', hideRhythm: true },
])('validates publication body', async (body) => {
  expect((await PUT(request('PUT', body))).status).toBe(400);
  expect(mockSave).not.toHaveBeenCalled();
});
it('rejects empty statistics', async () => {
  mockData.mockResolvedValue({
    earliestStartedAt: null,
    buckets: [],
    sessions: [],
  });
  expect(
    (await PUT(request('PUT', { year: 2025, tz: 'UTC', hideRhythm: false })))
      .status,
  ).toBe(400);
});
it('reads only the owner snapshot and returns opaque identity', async () => {
  mockRecap.mockResolvedValue({ report: { year: 2025, rhythmHidden: true } });
  const response = await publicGet(request('GET'), {
    params: Promise.resolve({ profileId: 'AbCdEf012345', year: '2025' }),
  });
  expect(await response.json()).toEqual({
    owner: { profileId: 'AbCdEf012345', nickname: '昵称', avatarSeed: null },
    isSelf: true,
    report: { year: 2025, rhythmHidden: true },
    years: [2025],
  });
  expect(mockRecap).toHaveBeenCalledWith('private-login', 2025);
  expect(mockData).not.toHaveBeenCalled();
  expect(mockReviews).not.toHaveBeenCalled();
  expect(response.headers.get('cache-control')).toContain('no-store');
});
it('requires login for public snapshots and returns 404 for unknown/unpublished reports', async () => {
  const context = {
    params: Promise.resolve({ profileId: 'AbCdEf012345', year: '2025' }),
  };
  expect((await publicGet(request('GET'), context)).status).toBe(404);
  mockProfile.mockResolvedValue(null);
  expect((await publicGet(request('GET'), context)).status).toBe(404);
  const response = new Response('', { status: 401 });
  mockGuard.mockResolvedValue({ response });
  expect(await publicGet(request('GET'), context)).toBe(response);
});
