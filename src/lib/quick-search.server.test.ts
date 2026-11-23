/** @jest-environment node */

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { clearSearchCachesForTests } from '@/lib/search-cache';

import type { ActiveUserInfo } from './api-auth';
import { getAvailableApiSites } from './config';
import { getCachedDetail } from './detail-cache';
import { searchFirstPageFromApi } from './downstream';
import { resolvePlayableSourceForUser } from './quick-search.server';

jest.mock('@/lib/config', () => ({
  API_CONFIG: { search: { headers: {} } },
  getConfigForRead: jest.fn(async () => ({
    SourceConfig: [{ key: 'allowed' }, { key: 'forbidden' }],
    SiteConfig: { DisableYellowFilter: true },
  })),
  getAvailableApiSites: jest.fn(async () => [
    { key: 'allowed', name: 'Allowed', api: 'https://allowed.test' },
  ]),
}));
jest.mock('@/lib/source-health.server', () => ({
  getSourceHealthTiers: jest.fn(async () => new Map()),
  recordSourceSearchOutcome: jest.fn(),
}));
jest.mock('@/lib/downstream', () => ({ searchFirstPageFromApi: jest.fn() }));
jest.mock('@/lib/detail-cache', () => ({ getCachedDetail: jest.fn() }));
const user: ActiveUserInfo = {
  username: 'alice',
  role: 'user',
  isOwner: false,
};
const source = {
  source: 'allowed',
  id: '1',
  title: 'Show',
  year: '2026',
  source_name: 'Allowed',
  poster: 'https://img.test/a',
  episodes: ['https://video.test/a.m3u8'],
  episodes_titles: ['one'],
};

beforeEach(() => {
  jest.clearAllMocks();
  (searchFirstPageFromApi as jest.Mock).mockResolvedValue([source]);
});

it('searches only user-permitted sources and requires full detail for binding', async () => {
  (getCachedDetail as jest.Mock).mockResolvedValue({
    ...source,
    episodes: ['a', 'b'],
    series_status: 'ongoing',
  });
  const result = await resolvePlayableSourceForUser({
    user,
    query: 'Show',
    year: '2026',
    requireFullDetail: true,
  });
  expect(getAvailableApiSites).toHaveBeenCalledWith(
    'alice',
    expect.any(Object),
    user.userAccess,
  );
  expect(searchFirstPageFromApi).toHaveBeenCalledTimes(1);
  expect(searchFirstPageFromApi).toHaveBeenCalledWith(
    expect.objectContaining({ key: 'allowed' }),
    'Show',
    expect.any(Object),
  );
  expect(getCachedDetail).toHaveBeenCalledTimes(1);
  expect(result.detail?.episodes).toEqual(['a', 'b']);
});

it.each(['unknown', '2025'])(
  'rejects mismatched detail year %s',
  async (year) => {
    (getCachedDetail as jest.Mock).mockResolvedValue({ ...source, year });
    const result = await resolvePlayableSourceForUser({
      user,
      query: 'Show',
      year: '2026',
      requireFullDetail: true,
    });
    expect(result.detail).toBeNull();
  },
);

it('does not fall back to the search snapshot when detail fails', async () => {
  (getCachedDetail as jest.Mock).mockRejectedValue(new Error('unavailable'));
  expect(
    (
      await resolvePlayableSourceForUser({
        user,
        query: 'Show',
        year: '2026',
        requireFullDetail: true,
      })
    ).detail,
  ).toBeNull();
});

it('原词只返回龍珠超时，精确补查龙珠并返回可播候选', async () => {
  installStreamPolyfills();
  clearSearchCachesForTests();
  const originalFetch = global.fetch;
  const fetchMock = jest.fn(
    async (url: string) =>
      new Response(
        JSON.stringify({
          list: [
            {
              vod_id: 1,
              vod_name:
                new URL(url).searchParams.get('wd') === '龍珠'
                  ? '龍珠超'
                  : '龙珠',
              vod_pic: source.poster,
              vod_year: '2026',
              vod_play_url: '1$https://video.test/a.m3u8',
            },
          ],
        }),
      ),
  );
  global.fetch = jest.fn().mockImplementation(fetchMock);
  (searchFirstPageFromApi as jest.Mock).mockImplementation(
    jest.requireActual('@/lib/downstream').searchFirstPageFromApi,
  );
  (getCachedDetail as jest.Mock).mockResolvedValue({
    ...source,
    title: '龙珠',
  });
  try {
    const result = await resolvePlayableSourceForUser({
      user,
      query: '龍珠',
      year: '2026',
    });
    expect(result.detail?.title).toBe('龙珠');
    expect(
      fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get('wd')),
    ).toEqual(['龍珠', '龙珠']);
  } finally {
    global.fetch = originalFetch;
    clearSearchCachesForTests();
  }
});
