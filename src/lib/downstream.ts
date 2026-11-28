import {
  buildCmsSearchUrl,
  mapCmsSearchItem,
  parseCmsSearchPayload,
  parseVodPlayUrl,
} from '@/lib/cms-search.server';
import { waitForSharedLoad } from '@/lib/concurrency';
import { API_CONFIG, ApiSite, getConfigForRead } from '@/lib/config';
import {
  type SpecialSourceAdapter,
  getSpecialSourceAdapter,
} from '@/lib/downstream-sources/registry.server';
import {
  createTimedAbortController,
  runWithConcurrency,
} from '@/lib/downstream-sources/shared';
import { getUpstreamErrorType } from '@/lib/proxy-diagnostics';
import {
  readJsonLimited,
  readTextLimited,
  UPSTREAM_METADATA_MAX_BYTES,
} from '@/lib/proxy-response-limits';
import {
  DEFAULT_RUNTIME_PARAMS,
  normalizeRuntimeParams,
} from '@/lib/runtime-params';
import {
  type SearchPageLoadResult,
  acquireUpstreamSearchSlot,
  dedupeSearchLoad,
  getCachedSearchPage,
  loadSpecialSourceSearch,
  peekCachedSearchPage,
  setCachedSearchPage,
} from '@/lib/search-cache';
import { searchWithScriptFallback } from '@/lib/search-script-fallback';
import { SearchSourceUnavailableError } from '@/lib/search-source-error';
import { isTitleMatchedSearchQuery } from '@/lib/search-text';
import { parseSeriesStatus } from '@/lib/series-status';
import {
  ResourceLimitError,
  UpstreamCooldownError,
} from '@/lib/server-resource-errors';
import { getSourceCacheKey } from '@/lib/source-cache-key';
import {
  type SourceSearchOutcome,
  recordSourceSearchOutcome,
} from '@/lib/source-health.server';
import { SearchResult } from '@/lib/types';
import { fetchUpstream } from '@/lib/upstream-fetch.server';
import { UrlValidationError } from '@/lib/url-guard';
import { cleanHtmlTags, normalizeInlineText } from '@/lib/utils';

interface SearchFromApiOptions {
  maxSearchPages?: number;
  isMatch?: (result: SearchResult) => boolean;
  signal?: AbortSignal;
  // 第 1 页失败时抛 SearchSourceUnavailableError，而不是返回空结果
  reportFailure?: boolean;
  // 第 1 页跳过缓存与在途合并，直接回源
  refreshFirstPage?: boolean;
}

const EXTRA_SEARCH_PAGE_CONCURRENCY = 2;

async function readSearchRuntimeParams() {
  try {
    const config = await getConfigForRead();
    return normalizeRuntimeParams(config.SiteConfig);
  } catch {
    return DEFAULT_RUNTIME_PARAMS;
  }
}

async function searchWithCache(
  apiSite: ApiSite,
  query: string,
  page: number,
  url: string,
  timeoutMs = 8000,
  signal?: AbortSignal,
): Promise<SearchPageLoadResult> {
  if (signal?.aborted) {
    return { results: [] };
  }

  const cacheSource = getSourceCacheKey(apiSite);
  const cached = getCachedSearchPage(cacheSource, query, page);
  if (cached) {
    if (cached.status === 'ok') {
      return { results: cached.data, pageCount: cached.pageCount };
    } else {
      return { results: [], failed: true };
    }
  }

  const stale = peekCachedSearchPage(cacheSource, query, page);
  if (stale && !stale.fresh) {
    dedupeSearchLoad(cacheSource, query, page, () =>
      fetchAndCacheSearchPage(apiSite, query, page, url, timeoutMs),
    ).catch(() => {});
    if (stale.entry.status === 'ok') {
      return { results: stale.entry.data, pageCount: stale.entry.pageCount };
    }
    return { results: [], failed: true };
  }

  return waitForSharedLoad(
    () =>
      dedupeSearchLoad(cacheSource, query, page, () =>
        fetchAndCacheSearchPage(apiSite, query, page, url, timeoutMs),
      ),
    signal,
  );
}

type SearchFailureReason =
  | 'http'
  | 'invalid-payload'
  | 'timeout'
  | 'upstream-cooldown'
  | 'request'
  | 'adapter';

function getSearchFailureMessage(error: unknown, reason: SearchFailureReason) {
  if (error instanceof UrlValidationError) {
    // URL guard 当前只产生固定原因；白名单保证后续新增原因也不会泄露地址。
    switch (error.reason) {
      case 'Invalid URL':
      case 'Only http/https allowed':
      case 'Blocked destination':
      case 'DNS lookup failed':
      case 'Redirect not allowed':
      case 'Too many redirects':
        return error.reason;
      default:
        return 'URL validation failed';
    }
  }
  // JSON.parse 的报错会带上正文片段，可能回显关键词，只记录固定说明。
  if (error instanceof SyntaxError) return '响应不是有效 JSON';
  return reason === 'adapter' && error instanceof Error ? error.message : null;
}

// 仅在真实回源失败时记录；健康样本只分 ok/empty/error，失败原因靠这条日志区分。
// 不记录搜索关键词与地址，避免把用户输入写进日志。
function logSearchFailure(
  apiSite: ApiSite,
  page: number,
  reason: SearchFailureReason,
  startedAt: number,
  detail: { status?: number; error?: unknown } = {},
): void {
  console.warn('[search.failure]', {
    source: apiSite.key,
    page,
    reason,
    status: detail.status ?? null,
    errorType: detail.error
      ? (getUpstreamErrorType(detail.error) ?? null)
      : null,
    message: getSearchFailureMessage(detail.error, reason),
    elapsedMs: Date.now() - startedAt,
  });
}

async function fetchAndCacheSearchPage(
  apiSite: ApiSite,
  query: string,
  page: number,
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SearchPageLoadResult> {
  if (signal?.aborted) {
    return { results: [] };
  }

  const releaseSearchSlot = await acquireUpstreamSearchSlot(signal);
  const abortState = createTimedAbortController(signal, timeoutMs);
  const startedAt = Date.now();
  let outcome: SourceSearchOutcome = 'error';
  let latencyMs = 0;
  let resourceLimited = false;

  try {
    const response = await fetchUpstream(url, {
      headers: API_CONFIG.search.headers,
      signal: abortState.signal,
    });

    if (!response.ok) {
      await response.body?.cancel();
      logSearchFailure(apiSite, page, 'http', startedAt, {
        status: response.status,
      });
      if (response.status === 403) {
        setCachedSearchPage(
          getSourceCacheKey(apiSite),
          query,
          page,
          'forbidden',
          [],
        );
      }
      return { results: [], failed: true };
    }

    const data = parseCmsSearchPayload(
      await readJsonLimited<unknown>(response, UPSTREAM_METADATA_MAX_BYTES),
    );
    latencyMs = Date.now() - startedAt;
    if (!data) {
      logSearchFailure(apiSite, page, 'invalid-payload', startedAt);
      setCachedSearchPage(
        getSourceCacheKey(apiSite),
        query,
        page,
        'invalid',
        [],
      );
      return { results: [], failed: true };
    }
    outcome = data.list.length > 0 ? 'ok' : 'empty';
    if (data.list.length === 0) {
      const pageCount = page === 1 ? data.pageCount : undefined;
      setCachedSearchPage(
        getSourceCacheKey(apiSite),
        query,
        page,
        'ok',
        [],
        pageCount,
      );
      return { results: [], pageCount };
    }

    const results = data.list
      .map((item) => mapCmsSearchItem(apiSite, item))
      .filter((result) => result.episodes.length > 0);

    const pageCount = page === 1 ? data.pageCount : undefined;
    setCachedSearchPage(
      getSourceCacheKey(apiSite),
      query,
      page,
      'ok',
      results,
      pageCount,
    );
    return { results, pageCount };
  } catch (error: any) {
    if (error instanceof ResourceLimitError) {
      resourceLimited = true;
      // 冷却命中与本站限额不是上游的真实失败；只有本次收到 429 / 503 时记录
      if (error instanceof UpstreamCooldownError && error.responseReceived) {
        logSearchFailure(apiSite, page, 'upstream-cooldown', startedAt);
      }
      throw error;
    }
    abortState.cleanup();
    const timedOut = abortState.isTimeout();
    const abortedByParent = Boolean(signal?.aborted && !timedOut);
    if (!abortedByParent) {
      logSearchFailure(
        apiSite,
        page,
        timedOut ? 'timeout' : 'request',
        startedAt,
        { error },
      );
    }
    // 超时以 Error('timeout') 中止，fetch 原样抛出该 reason，不能用 isAbortError 识别
    if (timedOut) {
      setCachedSearchPage(
        getSourceCacheKey(apiSite),
        query,
        page,
        'timeout',
        [],
      );
    }
    return { results: [], failed: !abortedByParent };
  } finally {
    releaseSearchSlot();
    abortState.cleanup();
    const abortedByParent = Boolean(signal?.aborted && !abortState.isTimeout());
    if (page === 1 && !resourceLimited && !abortedByParent) {
      recordSourceSearchOutcome(apiSite.key, outcome, latencyMs);
    }
  }
}

export async function probeSourceSearch(
  apiSite: ApiSite,
  query: string,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;

  const specialSearch = getSpecialSourceAdapter(apiSite)?.search;
  if (specialSearch) {
    try {
      // 跳过特殊源共享搜索缓存，直接回源采样
      await searchSpecialSourceWithSample(
        apiSite,
        query,
        specialSearch,
        signal,
      );
    } catch (error) {
      console.warn(`Source health probe failed [${apiSite.key}]`, error);
    }
    return;
  }

  try {
    const runtimeParams = await readSearchRuntimeParams();
    // Bypass cache reads and in-flight search deduplication to collect a fresh sample.
    await fetchAndCacheSearchPage(
      apiSite,
      query,
      1,
      buildCmsSearchUrl(apiSite.api, query),
      runtimeParams.SearchRequestTimeoutSeconds * 1000,
      signal,
    );
  } catch (error) {
    console.warn(`Source health probe failed [${apiSite.key}]`, error);
  }
}

type SpecialSourceSearch = SpecialSourceAdapter['search'];

// 适配器失败时抛错、真正无结果时返回空数组，据此记 error / empty / ok
async function searchSpecialSourceWithSample(
  apiSite: ApiSite,
  query: string,
  search: SpecialSourceSearch,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const releaseSearchSlot = await acquireUpstreamSearchSlot(signal);
  const startedAt = Date.now();
  let outcome: SourceSearchOutcome = 'error';
  let resourceLimited = false;
  try {
    const results = await search(apiSite, query, signal);
    outcome = results.length > 0 ? 'ok' : 'empty';
    return results;
  } catch (error) {
    resourceLimited = error instanceof ResourceLimitError;
    if (!signal?.aborted) {
      if (!resourceLimited) {
        logSearchFailure(apiSite, 1, 'adapter', startedAt, { error });
      } else if (
        error instanceof UpstreamCooldownError &&
        error.responseReceived
      ) {
        logSearchFailure(apiSite, 1, 'upstream-cooldown', startedAt);
      }
    }
    throw error;
  } finally {
    releaseSearchSlot();
    if (!resourceLimited && !signal?.aborted) {
      recordSourceSearchOutcome(apiSite.key, outcome, Date.now() - startedAt);
    }
  }
}

// 共享加载不绑定单个请求的取消，消费者取消只放弃等待
async function searchSpecialSource(
  apiSite: ApiSite,
  query: string,
  search: SpecialSourceSearch,
  options: SearchFromApiOptions = {},
): Promise<SearchResult[]> {
  const { signal, reportFailure } = options;
  try {
    return await waitForSharedLoad(
      () =>
        loadSpecialSourceSearch(getSourceCacheKey(apiSite), query, () =>
          searchSpecialSourceWithSample(apiSite, query, search),
        ),
      signal,
    );
  } catch (error) {
    if (signal?.aborted) return [];
    if (error instanceof ResourceLimitError) throw error;
    if (reportFailure) throw new SearchSourceUnavailableError(apiSite.name);
    return [];
  }
}

// 各页独立缓存、排名漂移会造成页间重叠；(source, id) 是网格 key，须保留首次出现的条目。
function uniqueSearchResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const unique = results.filter((item) => {
    const key = `${item.source}\u0000${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length === results.length ? results : unique;
}

async function searchFromApiQuery(
  apiSite: ApiSite,
  query: string,
  options: SearchFromApiOptions = {},
): Promise<SearchResult[]> {
  if (options.signal?.aborted) {
    return [];
  }

  const specialSearch = getSpecialSourceAdapter(apiSite)?.search;
  if (specialSearch) {
    return uniqueSearchResults(
      await searchSpecialSource(apiSite, query, specialSearch, options),
    );
  }

  try {
    const runtimeParams = await readSearchRuntimeParams();
    const searchTimeoutMs = runtimeParams.SearchRequestTimeoutSeconds * 1000;
    const apiUrl = buildCmsSearchUrl(apiSite.api, query);

    const firstPageResult = options.refreshFirstPage
      ? await fetchAndCacheSearchPage(
          apiSite,
          query,
          1,
          apiUrl,
          searchTimeoutMs,
          options.signal,
        )
      : await searchWithCache(
          apiSite,
          query,
          1,
          apiUrl,
          searchTimeoutMs,
          options.signal,
        );
    if (
      firstPageResult.failed &&
      options.reportFailure &&
      !options.signal?.aborted
    ) {
      throw new SearchSourceUnavailableError(apiSite.name);
    }
    let results = firstPageResult.results;
    const pageCountFromFirst = firstPageResult.pageCount;

    const MAX_SEARCH_PAGES =
      options.maxSearchPages ?? runtimeParams.SearchDownstreamMaxPage;

    const pageCount = pageCountFromFirst || 1;
    const pagesToFetch = Math.min(pageCount - 1, MAX_SEARCH_PAGES - 1);

    if (pagesToFetch > 0) {
      results = [...results];
      const additionalPageTasks = [];

      for (let page = 2; page <= pagesToFetch + 1; page++) {
        const pageUrl = buildCmsSearchUrl(apiSite.api, query, page);

        additionalPageTasks.push(async () => {
          if (options.signal?.aborted) {
            return [];
          }

          const pageResult = await searchWithCache(
            apiSite,
            query,
            page,
            pageUrl,
            searchTimeoutMs,
            options.signal,
          );
          return pageResult.results;
        });
      }

      const additionalResults = await runWithConcurrency(
        additionalPageTasks,
        EXTRA_SEARCH_PAGE_CONCURRENCY,
        () => !options.signal?.aborted,
      );

      additionalResults.forEach((pageResults) => {
        if (pageResults.length > 0) {
          results.push(...pageResults);
        }
      });
    }

    return uniqueSearchResults(results);
  } catch (error) {
    if (
      error instanceof ResourceLimitError ||
      error instanceof SearchSourceUnavailableError
    ) {
      throw error;
    }
    return [];
  }
}

export async function searchFromApi(
  apiSite: ApiSite,
  query: string,
  options: SearchFromApiOptions = {},
): Promise<SearchResult[]> {
  if (options.signal?.aborted) return [];
  try {
    return await searchWithScriptFallback(
      query,
      (keyword, isFallback) =>
        searchFromApiQuery(apiSite, keyword, {
          ...options,
          maxSearchPages: isFallback ? 1 : options.maxSearchPages,
          reportFailure: true,
        }),
      (results) =>
        results.some(
          options.isMatch ??
            ((item) => isTitleMatchedSearchQuery(item.title, query)),
        ),
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) return [];
    if (error instanceof ResourceLimitError || options.reportFailure)
      throw error;
    return [];
  }
}

export async function searchFirstPageFromApi(
  apiSite: ApiSite,
  query: string,
  options: Pick<SearchFromApiOptions, 'signal' | 'isMatch'> = {},
): Promise<SearchResult[]> {
  return searchFromApi(apiSite, query, { ...options, maxSearchPages: 1 });
}

const PLAYBACK_URL_PATTERN =
  /(https?:\/\/[^"'\s]+?\.(?:m3u8|mp4)(?:[?#][^"'\s<]*)?)/gi;

export async function getDetailFromApi(
  apiSite: ApiSite,
  id: string,
): Promise<SearchResult> {
  const detail = getSpecialSourceAdapter(apiSite)?.detail;
  if (detail) return detail(apiSite, id);

  if (apiSite.detail) {
    return getDetailWithPageFallback(apiSite, id);
  }

  return getDetailFromVodApi(apiSite, id);
}

// 配了详情页的源仍以 JSON 接口为准，接口失败或没有可播放剧集时才抓详情页；
// 详情页只能可靠解析出剧集，元数据缺失时沿用接口返回的字段
async function getDetailWithPageFallback(
  apiSite: ApiSite,
  id: string,
): Promise<SearchResult> {
  let apiDetail: SearchResult | null = null;
  try {
    apiDetail = await getDetailFromVodApi(apiSite, id);
    if (apiDetail.episodes.length > 0) {
      return apiDetail;
    }
  } catch (error) {
    if (error instanceof ResourceLimitError) throw error;
  }

  const pageDetail = await handleSpecialSourceDetail(id, apiSite);
  if (!apiDetail) {
    return pageDetail;
  }
  return {
    ...apiDetail,
    title: pageDetail.title || apiDetail.title,
    poster: pageDetail.poster || apiDetail.poster,
    episodes: pageDetail.episodes,
    episodes_titles: pageDetail.episodes_titles,
    desc: pageDetail.desc || apiDetail.desc,
  };
}

async function getDetailFromVodApi(
  apiSite: ApiSite,
  id: string,
): Promise<SearchResult> {
  const detailUrl = `${apiSite.api}${API_CONFIG.detail.path}${id}`;

  const abortState = createTimedAbortController(undefined, 10000);
  try {
    const response = await fetchUpstream(detailUrl, {
      headers: API_CONFIG.detail.headers,
      signal: abortState.signal,
    });

    if (!response.ok) {
      throw new Error(`详情请求失败: ${response.status}`);
    }

    const data = await readJsonLimited<any>(
      response,
      UPSTREAM_METADATA_MAX_BYTES,
    );

    if (
      !data ||
      !data.list ||
      !Array.isArray(data.list) ||
      data.list.length === 0
    ) {
      throw new Error('获取到的详情内容无效');
    }

    const videoDetail = data.list[0];
    const { episodes: parsedEpisodes, titles } = videoDetail.vod_play_url
      ? parseVodPlayUrl(videoDetail.vod_play_url)
      : { episodes: [], titles: [] };
    let episodes = parsedEpisodes;

    if (episodes.length === 0 && videoDetail.vod_content) {
      const matches = videoDetail.vod_content.match(PLAYBACK_URL_PATTERN) || [];
      episodes = matches.map((link: string) => link.replace(/^\$/, ''));
    }

    return {
      id: id.toString(),
      title: normalizeInlineText(videoDetail.vod_name),
      poster: videoDetail.vod_pic,
      episodes,
      episodes_titles: titles,
      source: apiSite.key,
      source_name: apiSite.name,
      class: videoDetail.vod_class,
      year: videoDetail.vod_year
        ? videoDetail.vod_year.match(/\d{4}/)?.[0] || ''
        : 'unknown',
      desc: cleanHtmlTags(videoDetail.vod_content),
      type_name: videoDetail.type_name,
      series_status: parseSeriesStatus({
        ...videoDetail,
        episodeCount: episodes.length,
      }),
      douban_id: videoDetail.vod_douban_id,
    };
  } finally {
    abortState.cleanup();
  }
}

async function handleSpecialSourceDetail(
  id: string,
  apiSite: ApiSite,
): Promise<SearchResult> {
  const detailUrl = `${apiSite.detail}/index.php/vod/detail/id/${id}.html`;

  const abortState = createTimedAbortController(undefined, 10000);
  let html = '';
  try {
    const response = await fetchUpstream(detailUrl, {
      headers: API_CONFIG.detail.headers,
      signal: abortState.signal,
    });

    if (!response.ok) {
      throw new Error(`详情页请求失败: ${response.status}`);
    }

    html = await readTextLimited(response, UPSTREAM_METADATA_MAX_BYTES);
  } finally {
    abortState.cleanup();
  }

  let matches: string[] = [];

  if (apiSite.key === 'ffzy') {
    const ffzyPattern =
      /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
    matches = html.match(ffzyPattern) || [];
  }

  if (matches.length === 0) {
    const generalPattern =
      /\$(https?:\/\/[^"'\s]+?\.(?:m3u8|mp4)(?:[?#][^"'\s<]*)?)/gi;
    matches = html.match(generalPattern) || [];
  }

  matches = Array.from(new Set(matches)).map((link: string) => {
    link = link.substring(1);
    const parenIndex = link.indexOf('(');
    return parenIndex > 0 ? link.substring(0, parenIndex) : link;
  });

  const episodes_titles = Array.from({ length: matches.length }, (_, i) =>
    (i + 1).toString(),
  );

  const titleText = normalizeInlineText(
    html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1] || '',
  );

  const descMatch = html.match(
    /<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/,
  );
  const descText = descMatch ? cleanHtmlTags(descMatch[1]) : '';

  const coverMatch = html.match(/(https?:\/\/[^"'\s]+?\.jpg)/g);
  const coverUrl = coverMatch ? coverMatch[0].trim() : '';

  const yearMatch = html.match(/>(\d{4})</);
  const yearText = yearMatch ? yearMatch[1] : 'unknown';

  return {
    id,
    title: titleText,
    poster: coverUrl,
    episodes: matches,
    episodes_titles,
    source: apiSite.key,
    source_name: apiSite.name,
    class: '',
    year: yearText,
    desc: descText,
    type_name: '',
    douban_id: 0,
  };
}
