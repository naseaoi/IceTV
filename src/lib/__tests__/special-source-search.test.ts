import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { searchFirstPageFromApi, searchFromApi } from '@/lib/downstream';
import {
  clearSearchSourceFailureCooldownsForTests,
  collectSearchAggregation,
} from '@/lib/search-aggregate';
import { clearSearchCachesForTests } from '@/lib/search-cache';
import { SearchSourceUnavailableError } from '@/lib/search-source-error';
import { extractXgcartoonSearchResults } from '@/lib/xgcartoon';

jest.mock('@/lib/xgcartoon', () => {
  const actual = jest.requireActual('@/lib/xgcartoon');
  return {
    ...actual,
    extractXgcartoonSearchResults: jest.fn(
      actual.extractXgcartoonSearchResults,
    ),
  };
});

function resetXgcartoonParser() {
  (extractXgcartoonSearchResults as jest.Mock).mockImplementation(
    jest.requireActual('@/lib/xgcartoon').extractXgcartoonSearchResults,
  );
}

installStreamPolyfills();

const originalFetch = global.fetch;
const sources = [
  {
    key: 'giri',
    name: 'Giri',
    api: 'https://anime.girigirilove.icu',
    empty: JSON.stringify({ list: [] }),
    full: JSON.stringify({ list: [{ id: '1', name: 'Anime', pic: '' }] }),
  },
  {
    key: 'xgcartoon',
    name: 'Xgcartoon',
    api: 'https://www.xgcartoon.com',
    empty: '<html><body></body></html>',
    full: '<a href="/detail/anime" class="topic-list-item"><div class="h3 mb12">Anime</div></a>',
  },
];

describe.each(sources)('$key search failures', (site) => {
  const options = {
    apiSites: [site],
    query: 'Anime',
    maxSearchPages: 1,
    disableYellowFilter: true,
    sourceConcurrency: 1,
  };

  beforeEach(() => {
    clearSearchCachesForTests();
    clearSearchSourceFailureCooldownsForTests();
    global.fetch = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetXgcartoonParser();
    jest.restoreAllMocks();
  });

  it.each(['http', 'network', 'timeout', 'parse'])(
    'reports %s failures and retries without a cached empty result',
    async (failure) => {
      const fetchMock = global.fetch as jest.Mock;
      switch (failure) {
        case 'http':
          fetchMock.mockImplementation(
            async () => new Response('', { status: 503 }),
          );
          break;
        case 'network':
          fetchMock.mockRejectedValue(new TypeError('network error'));
          break;
        case 'timeout':
          fetchMock.mockRejectedValue(
            new DOMException('timeout', 'AbortError'),
          );
          break;
        case 'parse':
          fetchMock.mockImplementation(async () => new Response('{'));
          if (site.key === 'xgcartoon') {
            (extractXgcartoonSearchResults as jest.Mock).mockImplementation(
              () => {
                throw new Error('invalid document');
              },
            );
          }
          break;
      }
      const onSourceError = jest.fn();
      await expect(
        collectSearchAggregation({ ...options, onSourceError }),
      ).resolves.toEqual({
        results: [],
        failedSources: [site.key],
      });
      expect(onSourceError).toHaveBeenCalledWith(
        site,
        expect.any(SearchSourceUnavailableError),
      );

      // 默认调用方继续降级为空结果，异常只在聚合显式请求时上报。
      await expect(searchFromApi(site, 'Anime')).resolves.toEqual([]);
      await expect(searchFirstPageFromApi(site, 'Anime')).resolves.toEqual([]);

      resetXgcartoonParser();
      fetchMock.mockImplementation(async () => new Response(site.full));
      const recovered = await collectSearchAggregation({
        ...options,
        retryFailed: true,
      });
      expect(recovered.failedSources).toEqual([]);
      expect(recovered.results).toEqual([
        expect.objectContaining({ source: site.key, title: 'Anime' }),
      ]);
      const callsAfterRecovery = fetchMock.mock.calls.length;
      expect(await searchFirstPageFromApi(site, 'Anime')).toEqual(
        recovered.results,
      );
      expect(fetchMock).toHaveBeenCalledTimes(callsAfterRecovery);
    },
  );

  it('keeps genuine empty results out of failedSources and the cache', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(async () => new Response(site.empty));
    await expect(collectSearchAggregation(options)).resolves.toEqual({
      results: [],
      failedSources: [],
    });
    fetchMock.mockImplementation(async () => new Response(site.full));
    const recovered = await collectSearchAggregation(options);
    expect(recovered.failedSources).toEqual([]);
    expect(recovered.results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not report consumer cancellation as a source failure', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectSearchAggregation({ ...options, signal: controller.signal }),
    ).resolves.toEqual({
      results: [],
      failedSources: [],
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

it('uses a successful xgcartoon fallback without reporting failure', async () => {
  const site = sources[1];
  clearSearchCachesForTests();
  clearSearchSourceFailureCooldownsForTests();
  global.fetch = jest
    .fn()
    .mockImplementationOnce(async () => new Response('', { status: 503 }))
    .mockImplementation(async () => new Response(site.full));
  try {
    const result = await collectSearchAggregation({
      apiSites: [site],
      query: 'Anime',
      maxSearchPages: 1,
      disableYellowFilter: true,
      sourceConcurrency: 1,
    });
    expect(result.failedSources).toEqual([]);
    expect(result.results).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  } finally {
    global.fetch = originalFetch;
  }
});
