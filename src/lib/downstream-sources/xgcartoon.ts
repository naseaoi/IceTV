import type { ApiSite } from '@/lib/config';
import {
  buildXgcartoonPlaylistUrl,
  buildXgcartoonVideoPath,
  buildXgcartoonVariantId,
  extractXgcartoonEpisodeVariants,
  extractXgcartoonPlayerVid,
  extractXgcartoonSearchResults,
  parseXgcartoonVariantId,
  type XgcartoonEpisodeEntry,
} from '@/lib/xgcartoon';
import type { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

import {
  BROWSER_HTML_HEADERS,
  createTimedAbortController,
  getSiteOrigin,
  isAbortError,
  prioritizeOrigins,
  runWithConcurrency,
  toAbsoluteUrl,
  uniqueOrigins,
} from './shared';

const XGCARTOON_FALLBACK_ORIGINS = [
  'https://cn1.xgcartoon.com',
  'https://cn.xgcartoon.com',
  'https://www.xgcartoon.com',
];

export function isXgcartoonSource(apiSite: ApiSite): boolean {
  return /xgcartoon\.com/i.test(apiSite.api);
}

function getXgcartoonOrigins(apiSite: ApiSite): string[] {
  return uniqueOrigins([getSiteOrigin(apiSite), ...XGCARTOON_FALLBACK_ORIGINS]);
}

async function fetchXgcartoonHtml(
  url: string,
  signal?: AbortSignal,
  referer?: string,
): Promise<{ html: string; finalUrl: string } | null> {
  const abortState = createTimedAbortController(signal, 10000);

  try {
    const headers = referer
      ? { ...BROWSER_HTML_HEADERS, Referer: referer }
      : BROWSER_HTML_HEADERS;
    const res = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: abortState.signal,
    });
    if (!res.ok) {
      return null;
    }
    return {
      html: await res.text(),
      finalUrl: res.url || url,
    };
  } catch {
    return null;
  } finally {
    abortState.cleanup();
  }
}

async function fetchXgcartoonHtmlFromOrigins(
  origins: string[],
  path: string,
  signal?: AbortSignal,
  referer?: string,
): Promise<{ origin: string; html: string; finalUrl: string } | null> {
  for (const origin of origins) {
    if (signal?.aborted) {
      return null;
    }

    const url = toAbsoluteUrl(path, origin);
    const result = await fetchXgcartoonHtml(url, signal, referer);
    if (!result) {
      continue;
    }

    let finalOrigin = origin;
    try {
      finalOrigin = new URL(result.finalUrl).origin;
    } catch {}

    return {
      origin: finalOrigin,
      html: result.html,
      finalUrl: result.finalUrl,
    };
  }

  return null;
}

export async function searchFromXgcartoon(
  apiSite: ApiSite,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  if (!query.trim()) {
    return [];
  }

  const origins = getXgcartoonOrigins(apiSite);
  const searchPath = `/search?q=${encodeURIComponent(query)}`;

  try {
    const result = await fetchXgcartoonHtmlFromOrigins(
      origins,
      searchPath,
      signal,
    );
    if (!result) {
      return [];
    }

    const results = extractXgcartoonSearchResults(result.html);

    return results.map((item) => ({
      id: item.cartoonId,
      title: item.title,
      poster: toAbsoluteUrl(item.poster, result.origin),
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

function extractXgcartoonTitle(html: string): string {
  const rawTitle =
    html.match(
      /<div class="detail-right__title"[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/,
    )?.[1] ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ||
    html.match(/<title>([^<]+)/)?.[1] ||
    '';

  return cleanHtmlTags(rawTitle)
    .replace(/^🍴/, '')
    .replace(/\s*免费高清卡通动漫在线看\s*-\s*西瓜卡通\s*$/i, '')
    .trim();
}

function extractXgcartoonPoster(html: string, origin: string): string {
  const rawPoster =
    html.match(
      /<div class="detail-sider"[\s\S]*?<amp-img[^>]+src="([^"]+)"/i,
    )?.[1] ||
    html.match(/<amp-img[^>]+src="([^"]*\/cover\/[^"]+)"/i)?.[1] ||
    '';

  return toAbsoluteUrl(rawPoster.replace(/&amp;/g, '&'), origin);
}

function extractXgcartoonDesc(html: string): string {
  const rawDesc =
    html.match(
      /<div class="detail-right__desc[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/,
    )?.[1] || '';

  return cleanHtmlTags(rawDesc).trim();
}

function extractXgcartoonClass(html: string): string {
  return Array.from(
    html.matchAll(/<div class="tag tag-secondary"[^>]*>([\s\S]*?)<\/div>/g),
  )
    .map((match) => cleanHtmlTags(match[1]).trim())
    .filter(Boolean)
    .join(',');
}

async function fetchXgcartoonEpisodePlaylistUrl(
  origins: string[],
  cartoonId: string,
  episode: XgcartoonEpisodeEntry,
  referer: string,
): Promise<string | null> {
  const playPath = buildXgcartoonVideoPath(cartoonId, episode.chapterId);
  const result = await fetchXgcartoonHtmlFromOrigins(
    origins,
    playPath,
    undefined,
    referer,
  );
  if (!result) {
    return null;
  }

  const videoId = extractXgcartoonPlayerVid(result.html);
  return videoId ? buildXgcartoonPlaylistUrl(videoId) : null;
}

async function resolveXgcartoonEpisodes(
  origins: string[],
  cartoonId: string,
  episodes: XgcartoonEpisodeEntry[],
  referer: string,
): Promise<{ episodes: string[]; titles: string[] }> {
  const results = await runWithConcurrency(
    episodes.map((episode) => async () => {
      const url = await fetchXgcartoonEpisodePlaylistUrl(
        origins,
        cartoonId,
        episode,
        referer,
      );
      return url ? { url, title: episode.title } : null;
    }),
    4,
  );

  const resolvedEpisodes: string[] = [];
  const resolvedTitles: string[] = [];
  results.forEach((result, index) => {
    if (!result?.url) {
      return;
    }

    resolvedEpisodes.push(result.url);
    resolvedTitles.push(result.title || `${index + 1}`);
  });

  return {
    episodes: resolvedEpisodes,
    titles: resolvedTitles,
  };
}

export async function getDetailFromXgcartoon(
  apiSite: ApiSite,
  id: string,
): Promise<SearchResult> {
  const { cartoonId, groupId: preferredGroupId } = parseXgcartoonVariantId(id);
  const origins = getXgcartoonOrigins(apiSite);
  const detailResult = await fetchXgcartoonHtmlFromOrigins(
    origins,
    `/detail/${encodeURIComponent(cartoonId)}`,
  );

  if (!detailResult) {
    throw new Error('详情页请求失败');
  }

  const { origin, html, finalUrl } = detailResult;
  const activeOrigins = prioritizeOrigins(origins, origin);
  const title = extractXgcartoonTitle(html) || cartoonId;
  const poster = extractXgcartoonPoster(html, origin);
  const desc = extractXgcartoonDesc(html);
  const className = extractXgcartoonClass(html);
  const variants = extractXgcartoonEpisodeVariants(html);

  if (variants.length === 0) {
    throw new Error('未提取到剧集');
  }

  const selectedVariant =
    variants.find((variant) => variant.groupId === preferredGroupId) ||
    variants[0];
  const resolved = await resolveXgcartoonEpisodes(
    activeOrigins,
    cartoonId,
    selectedVariant.episodes,
    finalUrl,
  );

  if (resolved.episodes.length === 0) {
    throw new Error('未提取到有效播放地址');
  }

  const relatedSources: SearchResult[] = variants
    .filter((variant) => variant.groupId !== selectedVariant.groupId)
    .map((variant) => ({
      id: buildXgcartoonVariantId(
        cartoonId,
        variant.groupId,
        variant.isDefault,
      ),
      title,
      poster,
      episodes: [],
      episodes_titles: variant.episodes.map(
        (entry, index) => entry.title || `${index + 1}`,
      ),
      source: apiSite.key,
      source_name: apiSite.name,
      variant_label: variant.label,
      class: className,
      year: 'unknown',
      desc,
      type_name: '动漫',
      douban_id: 0,
    }));

  return {
    id: buildXgcartoonVariantId(
      cartoonId,
      selectedVariant.groupId,
      selectedVariant.isDefault,
    ),
    title,
    poster,
    episodes: resolved.episodes,
    episodes_titles: resolved.titles,
    source: apiSite.key,
    source_name: apiSite.name,
    variant_label: selectedVariant.label,
    related_sources: relatedSources,
    class: className,
    year: 'unknown',
    desc,
    type_name: '动漫',
    douban_id: 0,
  };
}
