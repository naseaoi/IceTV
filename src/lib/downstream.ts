import { API_CONFIG, ApiSite, getConfigForRead } from '@/lib/config';
import {
  getDetailFromGirigiri,
  isGirigiriSource,
  searchFromGirigiri,
} from '@/lib/downstream-sources/giri';
import {
  createTimedAbortController,
  isAbortError,
  runWithConcurrency,
} from '@/lib/downstream-sources/shared';
import {
  getDetailFromXgcartoon,
  isXgcartoonSource,
  searchFromXgcartoon,
} from '@/lib/downstream-sources/xgcartoon';
import {
  DEFAULT_RUNTIME_PARAMS,
  normalizeRuntimeParams,
} from '@/lib/runtime-params';
import {
  dedupeSearchLoad,
  getCachedSearchPage,
  peekCachedSearchPage,
  setCachedSearchPage,
} from '@/lib/search-cache';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

interface ApiSearchItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

interface SearchFromApiOptions {
  maxSearchPages?: number;
  signal?: AbortSignal;
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

function isSupportedVodPlaybackUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.m3u8') || pathname.endsWith('.mp4');
  } catch {
    return /\.(?:m3u8|mp4)(?:$|[?#])/i.test(url);
  }
}

function parseVodPlayUrl(vodPlayUrl: string): {
  episodes: string[];
  titles: string[];
} {
  let episodes: string[] = [];
  let titles: string[] = [];

  const sources = vodPlayUrl.split('$$$');
  for (const source of sources) {
    const matchEpisodes: string[] = [];
    const matchTitles: string[] = [];
    const pairs = source.split('#');
    for (const pair of pairs) {
      const parts = pair.split('$');
      if (parts.length === 2 && isSupportedVodPlaybackUrl(parts[1])) {
        matchTitles.push(parts[0]);
        matchEpisodes.push(parts[1]);
      }
    }
    if (matchEpisodes.length > episodes.length) {
      episodes = matchEpisodes;
      titles = matchTitles;
    }
  }

  return { episodes, titles };
}

async function searchWithCache(
  apiSite: ApiSite,
  query: string,
  page: number,
  url: string,
  timeoutMs = 8000,
  signal?: AbortSignal,
): Promise<{ results: SearchResult[]; pageCount?: number }> {
  if (signal?.aborted) {
    return { results: [] };
  }

  const cached = getCachedSearchPage(apiSite.key, query, page);
  if (cached) {
    if (cached.status === 'ok') {
      return { results: cached.data, pageCount: cached.pageCount };
    } else {
      return { results: [] };
    }
  }

  const stale = peekCachedSearchPage(apiSite.key, query, page);
  if (stale && !stale.fresh) {
    dedupeSearchLoad(apiSite.key, query, page, () =>
      fetchAndCacheSearchPage(apiSite, query, page, url, timeoutMs),
    ).catch(() => {});
    if (stale.entry.status === 'ok') {
      return { results: stale.entry.data, pageCount: stale.entry.pageCount };
    }
    return { results: [] };
  }

  return dedupeSearchLoad(apiSite.key, query, page, () =>
    fetchAndCacheSearchPage(apiSite, query, page, url, timeoutMs, signal),
  );
}

async function fetchAndCacheSearchPage(
  apiSite: ApiSite,
  query: string,
  page: number,
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ results: SearchResult[]; pageCount?: number }> {
  if (signal?.aborted) {
    return { results: [] };
  }

  const abortState = createTimedAbortController(signal, timeoutMs);

  try {
    const response = await fetch(url, {
      headers: API_CONFIG.search.headers,
      signal: abortState.signal,
    });

    if (!response.ok) {
      if (response.status === 403) {
        setCachedSearchPage(apiSite.key, query, page, 'forbidden', []);
      }
      return { results: [] };
    }

    const data = await response.json();
    if (
      !data ||
      !data.list ||
      !Array.isArray(data.list) ||
      data.list.length === 0
    ) {
      const pageCount = page === 1 ? data?.pagecount || 1 : undefined;
      setCachedSearchPage(apiSite.key, query, page, 'ok', [], pageCount);
      return { results: [], pageCount };
    }

    const allResults = data.list.map((item: ApiSearchItem) => {
      const { episodes, titles } = item.vod_play_url
        ? parseVodPlayUrl(item.vod_play_url)
        : { episodes: [], titles: [] };

      return {
        id: item.vod_id.toString(),
        title: item.vod_name.trim().replace(/\s+/g, ' '),
        poster: item.vod_pic,
        episodes,
        episodes_titles: titles,
        source: apiSite.key,
        source_name: apiSite.name,
        class: item.vod_class,
        year: item.vod_year
          ? item.vod_year.match(/\d{4}/)?.[0] || ''
          : 'unknown',
        desc: cleanHtmlTags(item.vod_content || ''),
        type_name: item.type_name,
        douban_id: item.vod_douban_id,
      };
    });

    const results = allResults.filter(
      (result: SearchResult) => result.episodes.length > 0,
    );

    const pageCount = page === 1 ? data.pagecount || 1 : undefined;
    setCachedSearchPage(apiSite.key, query, page, 'ok', results, pageCount);
    return { results, pageCount };
  } catch (error: any) {
    abortState.cleanup();
    const abortedByParent = Boolean(signal?.aborted && !abortState.isTimeout());
    if (isAbortError(error) && !abortedByParent) {
      setCachedSearchPage(apiSite.key, query, page, 'timeout', []);
    }
    return { results: [] };
  } finally {
    abortState.cleanup();
  }
}

export async function searchFromApi(
  apiSite: ApiSite,
  query: string,
  options: SearchFromApiOptions = {},
): Promise<SearchResult[]> {
  if (options.signal?.aborted) {
    return [];
  }

  if (isGirigiriSource(apiSite)) {
    return searchFromGirigiri(apiSite, query, options.signal);
  }

  if (isXgcartoonSource(apiSite)) {
    return searchFromXgcartoon(apiSite, query, options.signal);
  }

  try {
    const runtimeParams = await readSearchRuntimeParams();
    const searchTimeoutMs = runtimeParams.SearchRequestTimeoutSeconds * 1000;
    const apiBaseUrl = apiSite.api;
    const apiUrl =
      apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);

    const firstPageResult = await searchWithCache(
      apiSite,
      query,
      1,
      apiUrl,
      searchTimeoutMs,
      options.signal,
    );
    const results = firstPageResult.results;
    const pageCountFromFirst = firstPageResult.pageCount;

    const MAX_SEARCH_PAGES =
      options.maxSearchPages ?? runtimeParams.SearchDownstreamMaxPage;

    const pageCount = pageCountFromFirst || 1;
    const pagesToFetch = Math.min(pageCount - 1, MAX_SEARCH_PAGES - 1);

    if (pagesToFetch > 0) {
      const additionalPageTasks = [];

      for (let page = 2; page <= pagesToFetch + 1; page++) {
        const pageUrl =
          apiBaseUrl +
          API_CONFIG.search.pagePath
            .replace('{query}', encodeURIComponent(query))
            .replace('{page}', page.toString());

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

    return results;
  } catch (error) {
    return [];
  }
}

export async function searchFirstPageFromApi(
  apiSite: ApiSite,
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<SearchResult[]> {
  if (isGirigiriSource(apiSite)) {
    return searchFromGirigiri(apiSite, query, options.signal);
  }

  if (isXgcartoonSource(apiSite)) {
    return searchFromXgcartoon(apiSite, query, options.signal);
  }

  try {
    const runtimeParams = await readSearchRuntimeParams();
    const apiUrl =
      apiSite.api + API_CONFIG.search.path + encodeURIComponent(query);
    const firstPageResult = await searchWithCache(
      apiSite,
      query,
      1,
      apiUrl,
      runtimeParams.SearchRequestTimeoutSeconds * 1000,
      options.signal,
    );
    return firstPageResult.results;
  } catch {
    return [];
  }
}

const PLAYBACK_URL_PATTERN =
  /(https?:\/\/[^"'\s]+?\.(?:m3u8|mp4)(?:[?#][^"'\s<]*)?)/gi;

export async function getDetailFromApi(
  apiSite: ApiSite,
  id: string,
): Promise<SearchResult> {
  if (isGirigiriSource(apiSite)) {
    return getDetailFromGirigiri(apiSite, id);
  }

  if (isXgcartoonSource(apiSite)) {
    return getDetailFromXgcartoon(apiSite, id);
  }

  if (apiSite.detail) {
    return handleSpecialSourceDetail(id, apiSite);
  }

  const detailUrl = `${apiSite.api}${API_CONFIG.detail.path}${id}`;

  const abortState = createTimedAbortController(undefined, 10000);
  try {
    const response = await fetch(detailUrl, {
      headers: API_CONFIG.detail.headers,
      signal: abortState.signal,
    });

    if (!response.ok) {
      throw new Error(`详情请求失败: ${response.status}`);
    }

    const data = await response.json();

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
      title: videoDetail.vod_name,
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
    const response = await fetch(detailUrl, {
      headers: API_CONFIG.detail.headers,
      signal: abortState.signal,
    });

    if (!response.ok) {
      throw new Error(`详情页请求失败: ${response.status}`);
    }

    html = await response.text();
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

  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const titleText = titleMatch ? titleMatch[1].trim() : '';

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
