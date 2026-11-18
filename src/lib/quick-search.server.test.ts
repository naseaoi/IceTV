/** @jest-environment node */

import type { ActiveUserInfo } from './api-auth';
import { getAvailableApiSites } from './config';
import { getCachedDetail } from './detail-cache';
import { searchFirstPageFromApi } from './downstream';
import { resolvePlayableSourceForUser } from './quick-search.server';

jest.mock('@/lib/config', () => ({
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
