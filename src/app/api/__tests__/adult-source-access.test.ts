/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { getConfigForRead } from '@/lib/config';
import { getCachedDetail } from '@/lib/detail-cache';
import { searchFirstPageFromApi, searchFromApi } from '@/lib/downstream';
import { collectSearchAggregation } from '@/lib/search-aggregate';
import type { AdminConfig } from '@/types/admin';

installStreamPolyfills();
const mockUser = {
  username: 'viewer',
  role: 'user',
  userAccess: { username: 'viewer', role: 'user' },
};
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(async () => mockUser),
  isGuardFailure: () => false,
}));
jest.mock('@/lib/config', () => ({
  ...jest.requireActual('@/lib/config'),
  getConfigForRead: jest.fn(),
}));
jest.mock('@/lib/source-health.server', () => ({
  getSourceHealthTiers: jest.fn(async () => new Map()),
}));
jest.mock('@/lib/search-cache', () => ({
  peekCachedSearchAggregate: jest.fn(() => null),
  loadCachedSearchAggregate: jest.fn((_params, loader) => loader()),
  refreshCachedSearchAggregate: jest.fn((_params, loader) => loader()),
  setCachedSearchAggregate: jest.fn(),
  mergeRetriedSearchAggregate: jest.fn(),
}));
jest.mock('@/lib/search-aggregate', () => ({
  runSearchAggregation: jest.fn(async () => []),
  collectSearchAggregation: jest.fn(async () => ({
    results: [],
    failedSources: [],
  })),
}));
jest.mock('@/lib/downstream', () => ({
  searchFirstPageFromApi: jest.fn(async () => []),
  searchFromApi: jest.fn(async () => []),
}));
jest.mock('@/lib/detail-cache', () => ({
  getCachedDetail: jest.fn(async () => ({ id: '1' })),
}));
jest.mock('@/lib/downstream-sources/giri', () => ({
  isGirigiriSource: () => true,
  resolveGirigiriEpisodePlayUrlByPath: jest.fn(
    async () => 'https://media.example/video.m3u8',
  ),
}));
jest.mock('@/app/api/episode-url/cache', () => ({
  getEpisodeUrlCacheKey: () => 'test',
  episodeUrlCache: { getOrLoad: jest.fn((_key, loader) => loader()) },
}));

jest.mock('@/features/play/lib/sourceProbeGuard.server', () => ({
  withAuthenticatedSourceProbeBudget: (
    request: NextRequest,
    handler: (request: NextRequest, user: unknown) => unknown,
  ) => handler(request, mockUser),
}));

const sites = [
  {
    key: 'adult',
    name: 'Adult',
    api: 'https://adult.example',
    from: 'config',
    nsfw: true,
  },
  {
    key: 'ordinary',
    name: 'Ordinary',
    api: 'https://ordinary.example',
    from: 'custom',
  },
];
function request(path: string) {
  return {
    url: `http://localhost${path}`,
    signal: new AbortController().signal,
  } as NextRequest;
}
function configure(allowed: boolean) {
  jest.clearAllMocks();
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SiteConfig: { DisableYellowFilter: allowed },
    SourceConfig: sites,
    UserConfig: { Tags: [] },
  } as unknown as AdminConfig);
}

it.each([false, true])(
  'episode resolution checks source policy before using its cache (%s)',
  async (allowed) => {
    configure(allowed);
    const { GET } = require('@/app/api/episode-url/route');
    const {
      resolveGirigiriEpisodePlayUrlByPath,
    } = require('@/lib/downstream-sources/giri');
    const response = await GET(
      request(
        '/api/episode-url?source=adult&url=icetv-lazy://giri/playGV1-1-1/',
      ),
    );
    expect(response.status).toBe(allowed ? 200 : 400);
    expect(resolveGirigiriEpisodePlayUrlByPath).toHaveBeenCalledTimes(
      allowed ? 1 : 0,
    );
  },
);

it.each([false, true])(
  'search and streaming only schedule visible sources (%s)',
  async (allowed) => {
    configure(allowed);
    const { GET } = require('@/app/api/search/route');
    const { GET: stream } = require('@/app/api/search/ws/route');
    expect((await GET(request('/api/search?q=test'))).status).toBe(200);
    await (await stream(request('/api/search/ws?q=test'))).text();
    const expected = allowed ? ['adult', 'ordinary'] : ['ordinary'];
    expect(collectSearchAggregation).toHaveBeenCalledTimes(2);
    for (const [options] of (collectSearchAggregation as jest.Mock).mock
      .calls) {
      expect(options.apiSites.map((site: { key: string }) => site.key)).toEqual(
        expected,
      );
    }
  },
);

it.each([false, true])(
  'quick and suggestions never contact a filtered source (%s)',
  async (allowed) => {
    configure(allowed);
    const { GET: quick } = require('@/app/api/search/quick/route');
    const { GET: suggestions } = require('@/app/api/search/suggestions/route');
    await quick(request('/api/search/quick?q=test'));
    expect(
      (searchFirstPageFromApi as jest.Mock).mock.calls.map(
        ([site]) => site.key,
      ),
    ).toEqual(allowed ? ['adult', 'ordinary'] : ['ordinary']);
    (searchFirstPageFromApi as jest.Mock).mockClear();
    expect(
      (await suggestions(request('/api/search/suggestions?q=test'))).status,
    ).toBe(200);
    expect((searchFirstPageFromApi as jest.Mock).mock.calls[0][0].key).toBe(
      allowed ? 'adult' : 'ordinary',
    );
  },
);

it.each([false, true])(
  'single-source search and detail enforce access before upstream or cache (%s)',
  async (allowed) => {
    configure(allowed);
    const { GET: one } = require('@/app/api/search/one/route');
    const { GET: detail } = require('@/app/api/detail/route');
    await one(request('/api/search/one?q=test&resourceId=adult'));
    expect(searchFromApi).toHaveBeenCalledTimes(allowed ? 1 : 0);
    const response = await detail(request('/api/detail?source=adult&id=1'));
    expect(response.status).toBe(allowed ? 200 : 400);
    expect(getCachedDetail).toHaveBeenCalledTimes(allowed ? 1 : 0);
  },
);
