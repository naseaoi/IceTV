/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { validateSourceSearch } from '@/features/admin/lib/source-search-validation.server';
import type { ApiSite } from '@/lib/config';
import { getAvailableApiSites } from '@/lib/config';
import { getCachedDetail } from '@/lib/detail-cache';
import {
  getDetailFromApi,
  searchFirstPageFromApi,
  searchFromApi,
} from '@/lib/downstream';
import * as giri from '@/lib/downstream-sources/giri';
import {
  type SpecialSourceAdapter,
  getSpecialSourceAdapter,
  specialSourceAdapters,
} from '@/lib/downstream-sources/registry.server';
import * as tyyszy from '@/lib/downstream-sources/tyyszy';
import * as xgcartoon from '@/lib/downstream-sources/xgcartoon';
import * as xifan from '@/lib/downstream-sources/xifan';
import { buildLazyEpisodeUrl, parseLazyEpisodeUrl } from '@/lib/lazy-episodes';
import { resolvePlayableSourceForUser } from '@/lib/quick-search.server';
import { clearSearchCachesForTests } from '@/lib/search-cache';
import type { SearchResult } from '@/lib/types';

jest.mock('@/lib/config', () => ({
  API_CONFIG: {
    search: { headers: {} },
    detail: { headers: {}, path: '?ac=videolist&ids=' },
  },
  getConfigForRead: jest.fn(async () => ({
    SiteConfig: { DisableYellowFilter: true },
    SourceConfig: [],
  })),
  getAvailableApiSites: jest.fn(),
}));
jest.mock('@/lib/source-health.server', () => ({
  recordSourceSearchOutcome: jest.fn(),
  getSourceHealthTiers: jest.fn(async () => new Map()),
}));
jest.mock('@/lib/detail-cache', () => ({ getCachedDetail: jest.fn() }));
jest.mock('@/lib/downstream-sources/giri', () => ({
  ...jest.requireActual('@/lib/downstream-sources/giri'),
  searchFromGirigiri: jest.fn(),
  getDetailFromGirigiri: jest.fn(),
  resolveGirigiriEpisodePlayUrlByPath: jest.fn(),
}));
jest.mock('@/lib/downstream-sources/xgcartoon', () => ({
  ...jest.requireActual('@/lib/downstream-sources/xgcartoon'),
  searchFromXgcartoon: jest.fn(),
  getDetailFromXgcartoon: jest.fn(),
  resolveXgcartoonEpisodeUrlByPath: jest.fn(),
}));
jest.mock('@/lib/downstream-sources/xifan', () => ({
  ...jest.requireActual('@/lib/downstream-sources/xifan'),
  searchFromXifan: jest.fn(),
  getDetailFromXifan: jest.fn(),
  resolveXifanEpisodeUrlByPath: jest.fn(),
}));
jest.mock('@/lib/downstream-sources/tyyszy', () => ({
  ...jest.requireActual('@/lib/downstream-sources/tyyszy'),
  searchFromTyyszy: jest.fn(),
}));
jest.mock('@/features/play/lib/sourceProbeGuard.server', () => ({
  withAuthenticatedSourceProbeBudget: (
    request: NextRequest,
    handler: (request: NextRequest, user: object) => Promise<Response>,
  ) => handler(request, { username: 'viewer', role: 'user', isOwner: false }),
}));
jest.mock('@/app/api/episode-url/cache', () => ({
  getEpisodeUrlCacheKey: jest.fn(() => 'episode'),
  episodeUrlCache: {
    getOrLoad: jest.fn((_key, loader) => loader()),
    refresh: jest.fn((_key, loader) => loader()),
  },
}));
jest.mock('@/lib/server-proxy-guard', () => ({
  requireServerProxyQuota: jest.fn(async () => null),
}));

installStreamPolyfills();
const { GET: episodeGet } =
  require('@/app/api/episode-url/route') as typeof import('@/app/api/episode-url/route');

interface Fixture {
  api: string;
  search: SpecialSourceAdapter['search'];
  detail?: SpecialSourceAdapter['detail'];
  resolve?: NonNullable<SpecialSourceAdapter['episode']>['resolve'];
  path?: string;
}

const fixtures: Record<keyof typeof specialSourceAdapters, Fixture> = {
  giri: {
    api: 'https://anime.girigirilove.icu',
    search: giri.searchFromGirigiri,
    detail: giri.getDetailFromGirigiri,
    resolve: giri.resolveGirigiriEpisodePlayUrlByPath,
    path: '/playGV1-1-1/',
  },
  xgcartoon: {
    api: 'https://www.xgcartoon.com',
    search: xgcartoon.searchFromXgcartoon,
    detail: xgcartoon.getDetailFromXgcartoon,
    resolve: xgcartoon.resolveXgcartoonEpisodeUrlByPath,
    path: '/video/show/1.html',
  },
  xifan: {
    api: 'https://next.xifanacg.com',
    search: xifan.searchFromXifan,
    detail: xifan.getDetailFromXifan,
    resolve: xifan.resolveXifanEpisodeUrlByPath,
    path: '/anime/1/episode/1/source/2',
  },
  tyyszy: {
    api: 'https://tyyszy.com/api.php/provide/vod',
    search: tyyszy.searchFromTyyszy,
  },
};
const entries = Object.entries(specialSourceAdapters).map(
  ([name, adapter]) => ({
    name,
    adapter: adapter as SpecialSourceAdapter,
    fixture: fixtures[name as keyof typeof fixtures],
  }),
);
const user = { username: 'viewer', role: 'user' as const, isOwner: false };
const originalFetch = global.fetch;

function candidate(site: ApiSite): SearchResult {
  return {
    id: '1',
    source: site.key,
    source_name: site.name,
    title: 'Show',
    year: '2026',
    poster: 'https://img.example/1.jpg',
    episodes: ['https://media.example/1.m3u8'],
    episodes_titles: ['1'],
  };
}

function episodeRequest(site: ApiSite, url: string): NextRequest {
  return {
    url: `http://localhost/api/episode-url?${new URLSearchParams({ source: site.key, url })}`,
    signal: new AbortController().signal,
  } as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  clearSearchCachesForTests();
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  clearSearchCachesForTests();
  jest.restoreAllMocks();
});

describe.each(entries)(
  '$name registry contract',
  ({ name, adapter, fixture }) => {
    // 配置 key 与适配器名字无关，分派只依赖源地址。
    const site = {
      key: `custom-${name}`,
      name: `Custom ${name}`,
      api: fixture.api,
    };

    it('uniquely identifies its configured site', () => {
      expect(
        entries.filter(({ adapter: other }) => other.matches(site)),
      ).toEqual([expect.objectContaining({ name })]);
      expect(getSpecialSourceAdapter(site)).toBe(adapter);
      expect(
        getSpecialSourceAdapter({
          ...site,
          api: 'https://ordinary.example/api',
        }),
      ).toBeUndefined();
    });

    it.each([searchFromApi, searchFirstPageFromApi])(
      'dispatches the unified search entry to its own search function',
      async (search) => {
        const result = candidate(site);
        jest.mocked(fixture.search).mockResolvedValue([result]);
        expect(await search(site, 'Show')).toEqual([result]);
        expect(fixture.search).toHaveBeenCalledWith(site, 'Show', undefined);
        expect(fixture.search).toHaveBeenCalledTimes(1);
        for (const other of entries) {
          if (other.name !== name)
            expect(other.fixture.search).not.toHaveBeenCalled();
        }
        expect(global.fetch).not.toHaveBeenCalled();
      },
    );

    it('dispatches admin validation to its own search function with cancellation', async () => {
      jest.mocked(fixture.search).mockResolvedValue([candidate(site)]);
      const signal = new AbortController().signal;
      expect(await validateSourceSearch(site, 'Show', signal)).toBe('valid');
      expect(fixture.search).toHaveBeenCalledWith(site, 'Show', signal);
      expect(fixture.search).toHaveBeenCalledTimes(1);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    if (adapter.detail) {
      it('dispatches detail to its own detail function', async () => {
        expect(adapter.detail).toBe(fixture.detail);
        jest.mocked(fixture.detail!).mockResolvedValue(candidate(site));
        expect(await getDetailFromApi(site, '1')).toEqual(candidate(site));
        expect(fixture.detail).toHaveBeenCalledWith(site, '1');
        expect(global.fetch).not.toHaveBeenCalled();
      });
    } else {
      it('uses ordinary CMS detail when no detail function is declared', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(
          new Response(
            JSON.stringify({
              list: [
                {
                  vod_name: 'Show',
                  vod_play_url: '1$https://media.example/1.m3u8',
                },
              ],
            }),
          ),
        );
        expect((await getDetailFromApi(site, '1')).episodes).toEqual(
          candidate(site).episodes,
        );
        expect(global.fetch).toHaveBeenCalledWith(
          `${site.api}?ac=videolist&ids=1`,
          expect.any(Object),
        );
      });
    }

    it.each([false, true])(
      'quick respects search-start capability and full-detail requirement (%s)',
      async (requireFullDetail) => {
        const searchResult = candidate(site);
        jest.mocked(fixture.search).mockResolvedValue([searchResult]);
        jest.mocked(getAvailableApiSites).mockResolvedValue([site]);
        jest
          .mocked(getCachedDetail)
          .mockResolvedValue({ ...searchResult, desc: 'full detail' });
        const result = await resolvePlayableSourceForUser({
          user,
          query: 'Show',
          year: '2026',
          requireFullDetail,
        });
        expect(result.detail?.desc).toBe(
          adapter.canStartFromSearch && !requireFullDetail
            ? undefined
            : 'full detail',
        );
        expect(result.detail?.episodes).toEqual(searchResult.episodes);
        // 直接起播也为胜者后台补详情，区别是返回值是否等待并采用详情。
        expect(getCachedDetail).toHaveBeenCalledTimes(1);
      },
    );

    it.each([
      { poster: '' },
      { episodes: ['icetv-lazy://giri/playGV1-1-1/'] },
      { episodes_titles: [] },
      { variant_label: 'alternate' },
    ])(
      'quick still requires a complete direct-media snapshot (%j)',
      async (patch) => {
        jest
          .mocked(fixture.search)
          .mockResolvedValue([{ ...candidate(site), ...patch }]);
        jest.mocked(getAvailableApiSites).mockResolvedValue([site]);
        jest
          .mocked(getCachedDetail)
          .mockResolvedValue({ ...candidate(site), desc: 'full detail' });
        const result = await resolvePlayableSourceForUser({
          user,
          query: 'Show',
          year: '2026',
        });
        expect(result.detail?.desc).toBe('full detail');
      },
    );

    if (adapter.episode) {
      const episode = adapter.episode;
      const lazyUrl = buildLazyEpisodeUrl(episode.kind, fixture.path!);

      it('has a parser-compatible lazy kind and dispatches the route to its own resolver', async () => {
        expect(episode.kind).toBe(name);
        expect(episode.resolve).toBe(fixture.resolve);
        expect(parseLazyEpisodeUrl(lazyUrl)).toEqual({
          kind: episode.kind,
          path: fixture.path,
        });
        jest.mocked(getAvailableApiSites).mockResolvedValue([site]);
        jest
          .mocked(fixture.resolve!)
          .mockResolvedValue('https://media.example/resolved.m3u8');
        const response = await episodeGet(episodeRequest(site, lazyUrl));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          url: 'https://media.example/resolved.m3u8',
        });
        expect(fixture.resolve).toHaveBeenCalledWith(site, fixture.path);
        expect(fixture.resolve).toHaveBeenCalledTimes(1);
      });

      it('rejects other adapters and unavailable sources before resolution', async () => {
        for (const other of entries.filter((entry) => entry.name !== name)) {
          jest
            .mocked(getAvailableApiSites)
            .mockResolvedValue([{ ...site, api: other.fixture.api }]);
          expect((await episodeGet(episodeRequest(site, lazyUrl))).status).toBe(
            400,
          );
        }
        jest.mocked(getAvailableApiSites).mockResolvedValue([]);
        expect((await episodeGet(episodeRequest(site, lazyUrl))).status).toBe(
          400,
        );
        for (const entry of entries) {
          if (entry.fixture.resolve)
            expect(entry.fixture.resolve).not.toHaveBeenCalled();
        }
      });

      it('reports an empty resolution as failure instead of returning an empty URL', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.mocked(getAvailableApiSites).mockResolvedValue([site]);
        jest.mocked(fixture.resolve!).mockResolvedValue('');
        const response = await episodeGet(episodeRequest(site, lazyUrl));
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: '播放地址解析失败' });
      });
    }
  },
);

it('rejects an unknown lazy kind without falling through to a resolver', async () => {
  const site = { key: 'custom', name: 'Custom', api: fixtures.xgcartoon.api };
  jest.mocked(getAvailableApiSites).mockResolvedValue([site]);
  const response = await episodeGet(
    episodeRequest(site, 'icetv-lazy://unknown/video/show/1.html'),
  );
  expect(response.status).toBe(400);
  for (const { fixture } of entries) {
    if (fixture.resolve) expect(fixture.resolve).not.toHaveBeenCalled();
  }
});

it.each([
  ['https://anime.girigirilove.icu', 'giri'],
  ['https://girigirilove.com/api', 'giri'],
  ['https://cn1.xgcartoon.com', 'xgcartoon'],
  ['https://xgcartoon.com', 'xgcartoon'],
  ['https://cms.example/api.php/provide/vod?ref=girigirilove.icu', undefined],
  ['https://cms.example/xgcartoon.com/api', undefined],
  ['https://xgcartoon.com.cms.example/api', undefined],
  ['https://notgirigirilove.icu/api', undefined],
])('identifies %s by hostname only', (api, expected) => {
  const site = { key: 'custom', name: 'Custom', api };
  expect(entries.find(({ adapter }) => adapter.matches(site))?.name).toBe(
    expected,
  );
});
