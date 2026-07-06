import { type ApiSite, API_CONFIG } from '@/lib/config';
import {
  type GiriEpisodeVariant,
  buildGirigiriVariantId,
  countGirigiriVariantTabs,
  extractGirigiriEpisodeVariants,
  parseGirigiriVariantId,
} from '@/lib/giri';
import { buildLazyEpisodeUrl } from '@/lib/lazy-episodes';
import type { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

import {
  BROWSER_HTML_HEADERS,
  createTimedAbortController,
  getSiteOrigin,
  toAbsoluteUrl,
} from './shared';

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

export function isGirigiriSource(apiSite: ApiSite): boolean {
  return /girigirilove\./i.test(apiSite.api);
}

function isCfChallenge(html: string): boolean {
  return (
    html.includes('cf-browser-verification') ||
    html.includes('cf_chl_opt') ||
    html.includes('challenge-platform') ||
    (html.includes('Just a moment') && html.includes('cloudflare'))
  );
}

async function fetchGiriHtml(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const abortState = createTimedAbortController(undefined, 10000);
    try {
      const res = await fetch(url, {
        headers: BROWSER_HTML_HEADERS,
        signal: abortState.signal,
      });
      if (res.ok) {
        const html = await res.text();
        if (!isCfChallenge(html)) return html;
      }
    } catch {
      // 重试
    } finally {
      abortState.cleanup();
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

function getGirigiriOrigins(apiSite: ApiSite): string[] {
  return [getSiteOrigin(apiSite)];
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

export async function searchFromGirigiri(
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

async function resolveGirigiriEpisodeVariants(
  origins: string[],
  videoId: string,
  detailHtml: string,
): Promise<GiriEpisodeVariant[]> {
  const fromDetail = extractGirigiriEpisodeVariants(detailHtml);
  const tabCount = countGirigiriVariantTabs(detailHtml);

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

export async function getDetailFromGirigiri(
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
  const activeOrigins = origins;

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

  const episodes = selectedVariant.episodes.map((entry) =>
    buildLazyEpisodeUrl('giri', entry.playPath),
  );
  const episodesTitles = selectedVariant.episodes.map(
    (entry, index) => entry.title || `${index + 1}`,
  );

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
          title,
          poster,
          episodes: [],
          episodes_titles: variant.episodes.map(
            (entry, index) => entry.title || `${index + 1}`,
          ),
          source: apiSite.key,
          source_name: apiSite.name,
          variant_label: variant.label,
          class: '',
          year,
          desc,
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
    title,
    poster,
    episodes,
    episodes_titles: episodesTitles,
    source: apiSite.key,
    source_name: apiSite.name,
    variant_label: selectedVariant.label,
    class: '',
    year,
    desc,
    type_name: '动漫',
    douban_id: 0,
    related_sources: relatedSources,
  };
}

export async function resolveGirigiriEpisodePlayUrlByPath(
  apiSite: ApiSite,
  playPath: string,
): Promise<string | null> {
  const origins = getGirigiriOrigins(apiSite);
  const result = await fetchGirigiriEpisodePlayUrl(origins, playPath);
  return result.url;
}
