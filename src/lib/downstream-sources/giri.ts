import type { ApiSite } from '@/lib/config';
import {
  isGirigiriUrl,
  normalizeGirigiriHttpUrl,
  parseGirigiriPlaylists,
  parseGirigiriVariantId,
} from '@/lib/giri';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import type { SearchResult } from '@/lib/types';
import { cleanHtmlTags, normalizeInlineText } from '@/lib/utils';

import { requestSourceJson, requestSourceText } from './request.server';
import { BROWSER_HTML_HEADERS, getSiteOrigin } from './shared';

const API_ORIGIN = 'https://m3u8.girigirilove.com';
const IMAGE_ORIGIN = 'https://jpg.girigirilove.com/';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? normalizeInlineText(value) : '';
}

function positiveId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value).trim();
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? id : null;
}

export function isGirigiriSource(apiSite: ApiSite): boolean {
  return isGirigiriUrl(apiSite.api);
}

function toSearchResult(site: ApiSite, value: unknown): SearchResult | null {
  const item = object(value);
  if (!item) return null;
  const id = positiveId(item.vod_id);
  const title = text(item.vod_name);
  if (!id || !title) return null;
  const year =
    typeof item.vod_year === 'number'
      ? String(item.vod_year)
      : text(item.vod_year);
  return {
    id,
    title,
    poster: normalizeGirigiriHttpUrl(item.vod_pic, IMAGE_ORIGIN),
    episodes: [],
    episodes_titles: [],
    source: site.key,
    source_name: site.name,
    class: text(item.vod_class),
    year: /^\d{4}$/.test(year) ? year : 'unknown',
    desc: cleanHtmlTags(text(item.vod_content) || text(item.vod_blurb)),
    type_name: '动漫',
    douban_id: Number(positiveId(item.vod_douban_id) || 0),
  };
}

export async function searchFromGirigiri(
  apiSite: ApiSite,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  if (signal?.aborted) return [];
  const payload = object(
    await requestSourceJson(
      'girigiri 搜索',
      `${API_ORIGIN}/api.php/Vod/get_list?vod_name=${encodeURIComponent(query)}&limit=20&offset=0`,
      { headers: { Accept: 'application/json' }, signal, timeoutMs: 8000 },
    ),
  );
  const info = object(payload?.info);
  if (payload?.code !== 1 || !Array.isArray(info?.rows)) {
    throw new Error('girigiri 搜索响应无效');
  }
  const results = info.rows
    .map((item) => toSearchResult(apiSite, item))
    .filter((item): item is SearchResult => item !== null);
  if (info.rows.length > 0 && results.length === 0) {
    throw new Error('girigiri 搜索响应无效');
  }
  return results;
}

export async function getDetailFromGirigiri(
  apiSite: ApiSite,
  id: string,
): Promise<SearchResult> {
  const { videoId } = parseGirigiriVariantId(id);
  if (positiveId(videoId) !== videoId) throw new Error('无效的 girigiri 编号');
  const payload = object(
    await requestSourceJson(
      'girigiri 详情',
      `${API_ORIGIN}/api.php/Vod/get_detail?vod_id=${videoId}`,
      { headers: { Accept: 'application/json' } },
    ),
  );
  const info = object(payload?.info);
  const result = toSearchResult(apiSite, info);
  if (payload?.code !== 1 || !result || result.id !== videoId) {
    throw new Error('girigiri 详情响应无效');
  }
  return {
    ...result,
    ...parseGirigiriPlaylists(info?.vod_play_from, info?.vod_play_url),
  };
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
    try {
      const { text: html } = await requestSourceText('girigiri', url, {
        headers: BROWSER_HTML_HEADERS,
      });
      if (!isCfChallenge(html)) return html;
    } catch (error) {
      if (error instanceof ResourceLimitError) throw error;
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

function decodeGirigiriPlayUrl(rawUrl: string, encrypt: number): string {
  const normalized = rawUrl.replace(/\\\//g, '/');
  try {
    if (encrypt === 2) {
      return decodeURIComponent(
        Buffer.from(normalized, 'base64').toString('utf8'),
      );
    }
    return encrypt === 1 ? decodeURIComponent(normalized) : normalized;
  } catch {
    return normalized;
  }
}

// 旧详情快照与客户端缓存仍可能带 icetv-lazy://giri，保留按旧播放页取址。
export async function resolveGirigiriEpisodePlayUrlByPath(
  apiSite: ApiSite,
  playPath: string,
): Promise<string | null> {
  if (!/^\/playGV\d+-\d+-\d+\/$/.test(playPath)) return null;
  const html = await fetchGiriHtml(
    new URL(playPath, getSiteOrigin(apiSite)).href,
  );
  if (!html) return null;
  const playerBlock =
    html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\});/)?.[1] || '';
  const url = playerBlock.match(/"url":"([^"]+)"/)?.[1];
  if (!url) return null;
  const encrypt = Number(playerBlock.match(/"encrypt":(\d+)/)?.[1] || 0);
  const decoded = decodeGirigiriPlayUrl(url, encrypt);
  return (
    normalizeGirigiriHttpUrl(
      decoded.startsWith('//') ? `https:${decoded}` : decoded,
    ) || null
  );
}
