import { API_CONFIG, ApiSite, getConfig } from '@/lib/config';
import {
  buildGirigiriVariantId,
  countGirigiriVariantTabs,
  extractGirigiriEpisodeVariants,
  type GiriEpisodeVariant,
  parseGirigiriVariantId,
} from '@/lib/giri';
import {
  extractXgcartoonEpisodeVariants,
  extractXgcartoonSearchResults,
  type XgcartoonEpisodeEntry,
} from '@/lib/xgcartoon';
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

interface GirigiriSuggestItem {
  id: number | string;
  name: string;
  pic?: string;
}

interface GirigiriPlayExtractResult {
  url: string | null;
  title: string;
  year: string;
  desc: string;
  poster: string;
}

interface SearchFromApiOptions {
  maxSearchPages?: number;
  signal?: AbortSignal;
}

const GIRI_FALLBACK_ORIGINS = [
  'https://anime.girigirilove.icu',
  'https://ani.girigirilove.com',
];
const GIRI_DISABLED_ORIGINS = new Set(['https://anime.girigirilove.com']);
const EXTRA_SEARCH_PAGE_CONCURRENCY = 2;

function createTimedAbortController(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timeoutFired = false;

  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timeoutFired = true;
    controller.abort(new Error('timeout'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    isTimeout: () => timeoutFired,
    cleanup: () => {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'AbortError' ||
    (error as Error & { code?: number }).code === 20 ||
    error.message.includes('aborted')
  );
}

function isGirigiriSource(apiSite: ApiSite): boolean {
  return /girigirilove\.(?:com|icu)/i.test(apiSite.api);
}

function isXgcartoonSource(apiSite: ApiSite): boolean {
  return /xgcartoon\.com/i.test(apiSite.api);
}

// giri 页面请求用浏览器风格 headers，降低 CF 盾触发概率
const GIRI_HTML_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

/** 检测 HTML 是否为 Cloudflare challenge 页面 */
function isCfChallenge(html: string): boolean {
  return (
    html.includes('cf-browser-verification') ||
    html.includes('cf_chl_opt') ||
    html.includes('challenge-platform') ||
    (html.includes('Just a moment') && html.includes('cloudflare'))
  );
}

/** giri 页面 fetch，遇到 CF challenge 自动重试一次 */
async function fetchGiriHtml(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: GIRI_HTML_HEADERS });
      if (!res.ok) return null;
      const html = await res.text();
      if (!isCfChallenge(html)) return html;
      // CF challenge，等 1.5 秒后重试
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    } catch {
      return null;
    }
  }
  return null;
}

function getSiteOrigin(apiSite: ApiSite): string {
  const fallback = apiSite.api.replace(/\/+$/, '');
  try {
    return new URL(apiSite.api).origin;
  } catch {
    return fallback;
  }
}

function toAbsoluteUrl(url: string, origin: string): string {
  if (!url) return '';
  try {
    return new URL(url, origin).toString();
  } catch {
    return url;
  }
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '').toLowerCase();
}

function uniqueOrigins(origins: string[]): string[] {
  const seen = new Set<string>();
  return origins
    .map((origin) => origin.replace(/\/+$/, ''))
    .filter((origin) => {
      const normalized = normalizeOrigin(origin);
      if (
        !normalized ||
        seen.has(normalized) ||
        GIRI_DISABLED_ORIGINS.has(normalized)
      ) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

function isEnabledGirigiriOrigin(origin: string): boolean {
  return !GIRI_DISABLED_ORIGINS.has(normalizeOrigin(origin));
}

function includeEnabledGirigiriOrigin(origin: string): string[] {
  if (!isEnabledGirigiriOrigin(origin)) {
    return [];
  }
  return [origin];
}

function getGirigiriOrigins(apiSite: ApiSite): string[] {
  return uniqueOrigins([
    ...includeEnabledGirigiriOrigin(getSiteOrigin(apiSite)),
    ...GIRI_FALLBACK_ORIGINS,
  ]);
}

function prioritizeGirigiriOrigins(
  origins: string[],
  preferredOrigin: string,
): string[] {
  return uniqueOrigins([
    ...includeEnabledGirigiriOrigin(preferredOrigin),
    ...origins.filter((origin) => origin !== preferredOrigin),
  ]);
}

async function fetchGiriHtmlFromOrigins(
  origins: string[],
  path: string,
): Promise<{ origin: string; html: string } | null> {
  for (const origin of origins) {
    const html = await fetchGiriHtml(toAbsoluteUrl(path, origin));
    if (html) {
      return { origin, html };
    }
  }

  return null;
}

function decodeGirigiriPlayUrl(rawUrl: string, encrypt: number): string {
  const normalized = rawUrl.replace(/\\\//g, '/');

  if (encrypt === 2) {
    try {
      const base64Decoded = Buffer.from(normalized, 'base64').toString('utf8');
      return decodeURIComponent(base64Decoded);
    } catch {
      return normalized;
    }
  }

  if (encrypt === 1) {
    try {
      return decodeURIComponent(normalized);
    } catch {
      return normalized;
    }
  }

  return normalized;
}

function parseGirigiriEpisodePlayHtml(
  html: string,
  origin: string,
): GirigiriPlayExtractResult {
  const title =
    html.match(/class="player-title-link"[^>]*>([^<]+)<\/a>/)?.[1]?.trim() ||
    html.match(/<title>([^<_]+)/)?.[1]?.trim() ||
    '';
  const desc =
    cleanHtmlTags(
      html.match(/<div class="small-text">([\s\S]*?)<\/div>/)?.[1] ||
        html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ||
        '',
    ).trim() || '';
  const year =
    html.match(/<div class="cor4"\s+title="(\d{4})">/)?.[1] ||
    html.match(/<a[^>]*>(\d{4})<\/a>/)?.[1] ||
    'unknown';
  const poster = toAbsoluteUrl(
    html.match(/<div class="this-pic">[\s\S]*?data-src="([^"]+)"/i)?.[1] ||
      html.match(/<img[^>]+data-src="([^"]+)"/i)?.[1] ||
      '',
    origin,
  );

  const playerBlock =
    html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\});/)?.[1] || '';
  const encryptMatch = playerBlock.match(/"encrypt":(\d+)/);
  const urlMatch = playerBlock.match(/"url":"([^"]+)"/);
  if (!urlMatch) {
    return {
      url: null,
      title,
      year,
      desc,
      poster,
    };
  }

  const encrypt = encryptMatch ? Number(encryptMatch[1]) : 0;
  const decoded = decodeGirigiriPlayUrl(urlMatch[1], encrypt);
  const normalizedUrl = /^https?:\/\//i.test(decoded)
    ? decoded
    : decoded.startsWith('//')
      ? `https:${decoded}`
      : '';

  return {
    url: normalizedUrl || null,
    title,
    year,
    desc,
    poster,
  };
}

async function fetchGirigiriEpisodePlayUrl(
  origins: string[],
  playPath: string,
): Promise<GirigiriPlayExtractResult> {
  let fallbackResult: GirigiriPlayExtractResult | null = null;

  for (const origin of origins) {
    const playUrl = toAbsoluteUrl(playPath, origin);
    const html = await fetchGiriHtml(playUrl);
    if (!html) {
      continue;
    }

    const result = parseGirigiriEpisodePlayHtml(html, origin);
    if (result.url) {
      return result;
    }
    fallbackResult = fallbackResult || result;
  }

  return (
    fallbackResult || {
      url: null,
      title: '',
      year: 'unknown',
      desc: '',
      poster: '',
    }
  );
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  shouldContinue: () => boolean = () => true,
): Promise<T[]> {
  if (tasks.length === 0) return [];

  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (shouldContinue() && index < tasks.length) {
      const current = index;
      index += 1;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return results;
}

async function fetchGirigiriSuggestList(
  origin: string,
  query: string,
  signal?: AbortSignal,
): Promise<GirigiriSuggestItem[] | null> {
  const searchUrl = `${origin}/index.php/ajax/suggest?mid=1&wd=${encodeURIComponent(query)}`;

  const abortState = createTimedAbortController(signal, 8000);

  try {
    const response = await fetch(searchUrl, {
      headers: API_CONFIG.search.headers,
      signal: abortState.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data?.list)
      ? (data.list as GirigiriSuggestItem[])
      : null;
  } catch {
    return null;
  } finally {
    abortState.cleanup();
  }
}

async function searchFromGirigiri(
  apiSite: ApiSite,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const origins = getGirigiriOrigins(apiSite);

  for (const origin of origins) {
    if (signal?.aborted) {
      return [];
    }

    const list = await fetchGirigiriSuggestList(origin, query, signal);
    if (!list) {
      continue;
    }

    return list
      .map((item) => {
        const id = String(item.id || '').trim();
        const title = (item.name || '').trim();
        if (!id || !title) return null;

        return {
          id,
          title,
          poster: toAbsoluteUrl(item.pic || '', origin),
          episodes: [],
          episodes_titles: [],
          source: apiSite.key,
          source_name: apiSite.name,
          class: '',
          year: 'unknown',
          desc: '',
          type_name: '动漫',
          douban_id: 0,
        } as SearchResult;
      })
      .filter((item): item is SearchResult => Boolean(item));
  }

  return [];
}

async function searchFromXgcartoon(
  apiSite: ApiSite,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  if (!query.trim()) {
    return [];
  }

  const searchUrl = `https://www.xgcartoon.com/search?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(searchUrl, {
      headers: GIRI_HTML_HEADERS,
      signal,
    });

    if (!res.ok) {
      return [];
    }

    const html = await res.text();
    const results = extractXgcartoonSearchResults(html);

    return results.map((item) => ({
      id: item.cartoonId,
      title: item.title,
      poster: item.poster,
      episodes: [],
      episodes_titles: [],
      source: apiSite.key,
      source_name: apiSite.name,
      class: item.tags.join(','),
      year: 'unknown',
      desc: item.author,
      type_name: '动漫',
      douban_id: 0,
    }));
  } catch (error) {
    if (isAbortError(error)) {
      return [];
    }
    return [];
  }
}

// 解析 giri 详情页的多版本选集列表
async function resolveGirigiriEpisodeVariants(
  origins: string[],
  videoId: string,
  detailHtml: string,
): Promise<GiriEpisodeVariant[]> {
  const fromDetail = extractGirigiriEpisodeVariants(detailHtml);
  const tabCount = countGirigiriVariantTabs(detailHtml);

  // tab 条暗示版本数 <= 已解析版本数，或根本没有多 tab，直接返回
  if (tabCount <= fromDetail.length || tabCount < 2) {
    return fromDetail;
  }

  const probeGroupId = fromDetail[0]?.groupId || '1';
  const probePlayPath =
    fromDetail[0]?.episodes[0]?.playPath ||
    `/playGV${videoId}-${probeGroupId}-1/`;
  const probeResult = await fetchGiriHtmlFromOrigins(origins, probePlayPath);
  if (!probeResult?.html) {
    return fromDetail;
  }

  const fromProbe = extractGirigiriEpisodeVariants(probeResult.html);
  return fromProbe.length > fromDetail.length ? fromProbe : fromDetail;
}

async function getDetailFromGirigiri(
  apiSite: ApiSite,
  id: string,
): Promise<SearchResult> {
  const { videoId, groupId: preferredGroupId } = parseGirigiriVariantId(id);
  const origins = getGirigiriOrigins(apiSite);
  const detailResult = await fetchGiriHtmlFromOrigins(
    origins,
    `/GV${videoId}/`,
  );

  if (!detailResult?.html) {
    throw new Error('详情页请求失败或被 Cloudflare 拦截');
  }

  const { origin, html } = detailResult;
  const activeOrigins = prioritizeGirigiriOrigins(origins, origin);

  const title =
    html
      .match(/<h3 class="slide-info-title[^"]*">([^<]+)<\/h3>/)?.[1]
      ?.trim() ||
    html.match(/<title>([^<_]+)/)?.[1]?.trim() ||
    '';
  const descRaw =
    html.match(/id="height_limit"[^>]*>([\s\S]*?)<\/div>/)?.[1] ||
    html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ||
    '';
  const desc = cleanHtmlTags(descRaw).trim();
  const year =
    html.match(/<em class="cor4">年份：<\/em>\s*(\d{4})/)?.[1] ||
    html.match(/href="\/search\/[^"]*?(\d{4})\/"/)?.[1] ||
    html.match(/<a[^>]*>(\d{4})<\/a>/)?.[1] ||
    'unknown';
  const posterRaw =
    html.match(/<div class="detail-pic">[\s\S]*?data-src="([^"]+)"/i)?.[1] ||
    html.match(/<img[^>]+data-src="([^"]+)"/i)?.[1] ||
    '';
  const poster = toAbsoluteUrl(posterRaw, origin);

  const episodeVariants = await resolveGirigiriEpisodeVariants(
    activeOrigins,
    videoId,
    html,
  );
  if (episodeVariants.length === 0) {
    throw new Error('详情页未提取到可播放剧集');
  }

  const selectedVariant =
    episodeVariants.find((variant) => variant.groupId === preferredGroupId) ||
    episodeVariants[0];
  const episodeEntries = selectedVariant.episodes.map(
    (entry, index) =>
      [entry.playPath, entry.title || `${index + 1}`] as [string, string],
  );

  const playResults = await runWithConcurrency(
    episodeEntries.map(
      ([playPath]) =>
        async () =>
          fetchGirigiriEpisodePlayUrl(activeOrigins, playPath),
    ),
    4,
  );

  const episodes: string[] = [];
  const episodesTitles: string[] = [];
  playResults.forEach((result, index) => {
    if (result.url) {
      episodes.push(result.url);
      episodesTitles.push(episodeEntries[index][1]);
    }
  });

  const fallbackMeta = playResults.find(
    (item) => item.title || item.poster || item.desc || item.year !== 'unknown',
  );

  const finalTitle = title || fallbackMeta?.title || '';
  const finalPoster = poster || fallbackMeta?.poster || '';
  const finalYear = year !== 'unknown' ? year : fallbackMeta?.year || 'unknown';
  const finalDesc = desc || fallbackMeta?.desc || '';

  if (episodes.length === 0) {
    throw new Error('未提取到有效播放地址');
  }

  const relatedSources = episodeVariants
    .filter((variant) => variant.groupId !== selectedVariant.groupId)
    .map(
      (variant) =>
        ({
          id: buildGirigiriVariantId(
            videoId,
            variant.groupId,
            variant.isDefault,
          ),
          title: finalTitle,
          poster: finalPoster,
          episodes: [],
          episodes_titles: variant.episodes.map(
            (entry, index) => entry.title || `${index + 1}`,
          ),
          source: apiSite.key,
          source_name: apiSite.name,
          variant_label: variant.label,
          class: '',
          year: finalYear,
          desc: finalDesc,
          type_name: '动漫',
          douban_id: 0,
        }) satisfies SearchResult,
    );

  return {
    id: buildGirigiriVariantId(
      videoId,
      selectedVariant.groupId,
      selectedVariant.isDefault,
    ),
    title: finalTitle,
    poster: finalPoster,
    episodes,
    episodes_titles: episodesTitles,
    source: apiSite.key,
    source_name: apiSite.name,
    variant_label: selectedVariant.label,
    class: '',
    year: finalYear,
    desc: finalDesc,
    type_name: '动漫',
    douban_id: 0,
    related_sources: relatedSources,
  };
}

async function getDetailFromXgcartoon(
  apiSite: ApiSite,
  id: string,
): Promise<SearchResult> {
  const cartoonId = id;
  const detailUrl = `https://www.xgcartoon.com/detail/${cartoonId}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(detailUrl, {
      headers: GIRI_HTML_HEADERS,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error('详情页请求失败');
    }

    const html = await res.text();

    const title =
      html.match(/<h2[^>]*>([\s\S]*?)【[^\]]+】<\/h2>/)?.[1]?.trim() ||
      html.match(/<title>([^<]+)/)?.[1]?.trim() ||
      '';

    const posterMatch = html.match(
      /<amp-img[^>]+src="([^"]+)"[^>]*class="[^"]*detail-cover/,
    );
    const poster = posterMatch ? posterMatch[1].replace(/&amp;/g, '&') : '';

    const descMatch = html.match(
      /<div[^>]*class="[^"]*简介[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    );
    const desc = descMatch ? cleanHtmlTags(descMatch[1]).trim() : '';

    const variants = extractXgcartoonEpisodeVariants(html);

    if (variants.length === 0) {
      throw new Error('未提取到剧集');
    }

    // 使用第一个变体作为主结果
    const primaryVariant = variants[0];
    const episodeUrls = primaryVariant.episodes.map(
      (ep) =>
        `https://www.xgcartoon.com/user/page_direct?cartoon_id=${cartoonId}&chapter_id=${ep.chapterId}`,
    );
    const episodesTitles = primaryVariant.episodes.map((ep) => ep.title);

    // 构建其他变体作为 related_sources
    const relatedSources: SearchResult[] = variants.slice(1).map((variant) => {
      const variantEpisodeUrls = variant.episodes.map(
        (ep) =>
          `https://www.xgcartoon.com/user/page_direct?cartoon_id=${cartoonId}&chapter_id=${ep.chapterId}`,
      );
      const variantEpisodesTitles = variant.episodes.map((ep) => ep.title);

      return {
        id: `${cartoonId}_${variant.groupId}`,
        title: title || cartoonId,
        poster,
        episodes: variantEpisodeUrls,
        episodes_titles: variantEpisodesTitles,
        source: apiSite.key,
        source_name: apiSite.name,
        variant_label: variant.label,
        class: '',
        year: 'unknown',
        desc,
        type_name: '动漫',
        douban_id: 0,
      };
    });

    return {
      id: cartoonId,
      title: title || cartoonId,
      poster,
      episodes: episodeUrls,
      episodes_titles: episodesTitles,
      source: apiSite.key,
      source_name: apiSite.name,
      variant_label: primaryVariant.label,
      related_sources: relatedSources,
      class: '',
      year: 'unknown',
      desc,
      type_name: '动漫',
      douban_id: 0,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw new Error(`获取详情失败: ${error}`);
  }
}

// 从 vod_play_url 中解析出 m3u8 播放链接和对应标题
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
      if (parts.length === 2 && parts[1].endsWith('.m3u8')) {
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

/**
 * 通用的带缓存搜索函数
 */
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

  // 1. fresh 命中直接返回
  const cached = getCachedSearchPage(apiSite.key, query, page);
  if (cached) {
    if (cached.status === 'ok') {
      return { results: cached.data, pageCount: cached.pageCount };
    } else {
      return { results: [] };
    }
  }

  // 2. 软过期命中：立即返回旧值，同时后台刷新（若无同 key 请求在途）
  const stale = peekCachedSearchPage(apiSite.key, query, page);
  if (stale && !stale.fresh) {
    dedupeSearchLoad(apiSite.key, query, page, () =>
      fetchAndCacheSearchPage(apiSite, query, page, url, timeoutMs),
    ).catch(() => {
      /* 后台刷新失败保留旧值 */
    });
    if (stale.entry.status === 'ok') {
      return { results: stale.entry.data, pageCount: stale.entry.pageCount };
    }
    return { results: [] };
  }

  // 3. 完全未命中：回源（同 key 并发合并）
  return dedupeSearchLoad(apiSite.key, query, page, () =>
    fetchAndCacheSearchPage(apiSite, query, page, url, timeoutMs, signal),
  );
}

/**
 * 真正的回源逻辑，统一由 searchWithCache 调度，内部负责写入缓存。
 */
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

    abortState.cleanup();

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
      // 空结果不做负缓存要求，这里不写入缓存
      return { results: [] };
    }

    // 处理结果数据
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

    // 过滤掉集数为 0 的结果
    const results = allResults.filter(
      (result: SearchResult) => result.episodes.length > 0,
    );

    const pageCount = page === 1 ? data.pagecount || 1 : undefined;
    // 写入缓存（成功）
    setCachedSearchPage(apiSite.key, query, page, 'ok', results, pageCount);
    return { results, pageCount };
  } catch (error: any) {
    abortState.cleanup();
    const abortedByParent = Boolean(signal?.aborted && !abortState.isTimeout());
    if (isAbortError(error) && !abortedByParent) {
      setCachedSearchPage(apiSite.key, query, page, 'timeout', []);
    }
    return { results: [] };
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
    const apiBaseUrl = apiSite.api;
    const apiUrl =
      apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);

    // 使用新的缓存搜索函数处理第一页
    const firstPageResult = await searchWithCache(
      apiSite,
      query,
      1,
      apiUrl,
      8000,
      options.signal,
    );
    const results = firstPageResult.results;
    const pageCountFromFirst = firstPageResult.pageCount;

    const MAX_SEARCH_PAGES =
      options.maxSearchPages ??
      (await getConfig()).SiteConfig.SearchDownstreamMaxPage;

    // 获取总页数
    const pageCount = pageCountFromFirst || 1;
    // 确定需要获取的额外页数
    const pagesToFetch = Math.min(pageCount - 1, MAX_SEARCH_PAGES - 1);

    // 如果有额外页数，获取更多页的结果
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
            8000,
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

      // 合并所有页的结果
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
    const apiUrl =
      apiSite.api + API_CONFIG.search.path + encodeURIComponent(query);
    const firstPageResult = await searchWithCache(
      apiSite,
      query,
      1,
      apiUrl,
      6000,
      options.signal,
    );
    return firstPageResult.results;
  } catch {
    return [];
  }
}

// 匹配 m3u8 链接的正则
const M3U8_PATTERN = /(https?:\/\/[^"'\s]+?\.m3u8)/g;

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(detailUrl, {
    headers: API_CONFIG.detail.headers,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

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

  // 如果播放源为空，则尝试从内容中解析 m3u8
  if (episodes.length === 0 && videoDetail.vod_content) {
    const matches = videoDetail.vod_content.match(M3U8_PATTERN) || [];
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
}

async function handleSpecialSourceDetail(
  id: string,
  apiSite: ApiSite,
): Promise<SearchResult> {
  const detailUrl = `${apiSite.detail}/index.php/vod/detail/id/${id}.html`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(detailUrl, {
    headers: API_CONFIG.detail.headers,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`详情页请求失败: ${response.status}`);
  }

  const html = await response.text();
  let matches: string[] = [];

  if (apiSite.key === 'ffzy') {
    const ffzyPattern =
      /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
    matches = html.match(ffzyPattern) || [];
  }

  if (matches.length === 0) {
    const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
    matches = html.match(generalPattern) || [];
  }

  // 去重并清理链接前缀
  matches = Array.from(new Set(matches)).map((link: string) => {
    link = link.substring(1); // 去掉开头的 $
    const parenIndex = link.indexOf('(');
    return parenIndex > 0 ? link.substring(0, parenIndex) : link;
  });

  // 根据 matches 数量生成剧集标题
  const episodes_titles = Array.from({ length: matches.length }, (_, i) =>
    (i + 1).toString(),
  );

  // 提取标题
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const titleText = titleMatch ? titleMatch[1].trim() : '';

  // 提取描述
  const descMatch = html.match(
    /<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/,
  );
  const descText = descMatch ? cleanHtmlTags(descMatch[1]) : '';

  // 提取封面
  const coverMatch = html.match(/(https?:\/\/[^"'\s]+?\.jpg)/g);
  const coverUrl = coverMatch ? coverMatch[0].trim() : '';

  // 提取年份
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
