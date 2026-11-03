import {
  getCachedPlaybackPeriodSnapshot,
  getPlaybackPeriodStats,
} from './client';
import { buildPlaybackPeriod } from './period';

const mockAuth = jest.fn();
jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: () => mockAuth(),
}));

const originalFetch = global.fetch;
const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
  mockAuth.mockReturnValue({ username: 'client-test-user' });
});
afterAll(() => {
  global.fetch = originalFetch;
});

it('sends browser time zone and caches separate periods and anchor dates', async () => {
  const stats = buildPlaybackPeriod({ date: '2026-11-03' });
  mockFetch.mockResolvedValue({ ok: true, json: async () => stats });
  expect(await getPlaybackPeriodStats('week', '2026-11-03')).toEqual(stats);
  const [url, options] = mockFetch.mock.calls[0];
  const params = new URL(url, 'https://localhost').searchParams;
  expect(params.get('type')).toBe('week');
  expect(params.get('date')).toBe('2026-11-03');
  expect(params.get('tz')).toBe(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  expect(options).toEqual({ cache: 'no-store' });
  expect(getCachedPlaybackPeriodSnapshot('week', '2026-11-03')).toEqual(stats);
  expect(getCachedPlaybackPeriodSnapshot('year', '2026-11-03')).toBeNull();
  expect(getCachedPlaybackPeriodSnapshot('week', '2026-11-04')).toBeNull();
  mockAuth.mockReturnValue({ username: 'other-client-test-user' });
  expect(getCachedPlaybackPeriodSnapshot('week', '2026-11-03')).toBeNull();
});

it('uses the current-period cache key when date is omitted', async () => {
  const stats = buildPlaybackPeriod({ type: 'month' });
  mockFetch.mockResolvedValue({ ok: true, json: async () => stats });
  await getPlaybackPeriodStats('month');
  expect(
    new URL(mockFetch.mock.calls[0][0], 'https://localhost').searchParams.has(
      'date',
    ),
  ).toBe(false);
  expect(getCachedPlaybackPeriodSnapshot('month')).toEqual(stats);
});

it('keeps an in-flight response out of another user cache', async () => {
  let resolve!: (response: unknown) => void;
  mockAuth.mockReturnValue({ username: 'request-user' });
  mockFetch.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = getPlaybackPeriodStats('year');
  mockAuth.mockReturnValue({ username: 'replacement-user' });
  resolve({
    ok: true,
    json: async () => buildPlaybackPeriod({ type: 'year' }),
  });
  await pending;
  expect(getCachedPlaybackPeriodSnapshot('year')).toBeNull();
});

it('skips anonymous requests and propagates failed requests', async () => {
  mockAuth.mockReturnValue(null);
  expect(await getPlaybackPeriodStats('week')).toBeNull();
  expect(getCachedPlaybackPeriodSnapshot('week')).toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();
  mockAuth.mockReturnValue({ username: 'failed-user' });
  mockFetch.mockResolvedValue({ ok: false, status: 500 });
  await expect(getPlaybackPeriodStats('week')).rejects.toThrow('500');
});
