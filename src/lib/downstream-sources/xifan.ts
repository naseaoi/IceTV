import type { ApiSite } from '@/lib/config';
import { buildLazyEpisodeUrl } from '@/lib/lazy-episodes';
import {
  readJsonLimited,
  UPSTREAM_METADATA_MAX_BYTES,
} from '@/lib/proxy-response-limits';
import type { SearchResult } from '@/lib/types';
import { fetchUpstream } from '@/lib/upstream-fetch.server';
import { validateProxyUrlForRequest } from '@/lib/url-guard';
import { cleanHtmlTags, normalizeInlineText } from '@/lib/utils';

import { createTimedAbortController } from './shared';

const API_ORIGIN = 'https://api.xifanacg.com';
// 源站网页公开的 publishable key，仅用于游客 API，不是用户凭证。
const PUBLIC_API_KEY = 'sb_publishable_OBIVAWACIX6lPXrO98_z24_HcsmalkA';
const BACKUP_SOURCE_CODE = 'CS';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('稀饭返回的数据格式无效');
  }
  return value as JsonObject;
}

function text(value: unknown): string {
  return typeof value === 'string' ? normalizeInlineText(value) : '';
}

function parsePositiveId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value);
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? id : null;
}

function positiveId(value: unknown): string {
  const id = parsePositiveId(value);
  if (!id) throw new Error('稀饭返回的编号无效');
  return id;
}

export function isXifanSource(apiSite: ApiSite): boolean {
  try {
    return new URL(apiSite.api).origin === 'https://next.xifanacg.com';
  } catch {
    return false;
  }
}

async function requestXifan(
  path: string,
  body: JsonObject,
  signal?: AbortSignal,
): Promise<unknown> {
  const abortState = createTimedAbortController(signal, 10000);
  try {
    const response = await fetchUpstream(`${API_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLIC_API_KEY,
        Authorization: `Bearer ${PUBLIC_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: abortState.signal,
    });
    if (!response.ok) throw new Error(`稀饭请求失败 (${response.status})`);
    return await readJsonLimited<unknown>(
      response,
      UPSTREAM_METADATA_MAX_BYTES,
    );
  } finally {
    abortState.cleanup();
  }
}

function toSearchResult(apiSite: ApiSite, value: unknown): SearchResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const anime = value as JsonObject;
  const title = text(anime.title);
  const id = parsePositiveId(anime.id);
  if (!title || !id) return null;
  const year = String(anime.release_year ?? '');
  return {
    id,
    title,
    poster: text(anime.cover_url),
    episodes: [],
    episodes_titles: [],
    source: apiSite.key,
    source_name: apiSite.name,
    year: /^\d{4}$/.test(year) ? year : 'unknown',
    desc: cleanHtmlTags(text(anime.description)),
    type_name: '动漫',
    class: Array.isArray(anime.meta_tags)
      ? anime.meta_tags.map(text).filter(Boolean).join(',')
      : '',
    series_status:
      typeof anime.is_finished === 'boolean'
        ? anime.is_finished
          ? 'ended'
          : 'ongoing'
        : undefined,
    douban_id: 0,
  };
}

export async function searchFromXifan(
  apiSite: ApiSite,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const data = await requestXifan(
    '/rest/v1/rpc/search_animes',
    {
      search_term: query,
      page_number: 1,
      items_per_page: 24,
    },
    signal,
  );
  if (!Array.isArray(data)) throw new Error('稀饭搜索响应无效');
  const results = data
    .map((anime) => toSearchResult(apiSite, anime))
    .filter((item): item is SearchResult => item !== null);
  if (data.length > 0 && results.length === 0)
    throw new Error('稀饭搜索响应无效');
  return results;
}

export async function getDetailFromXifan(
  apiSite: ApiSite,
  id: string,
): Promise<SearchResult> {
  const animeId = positiveId(id);
  const data = object(
    await requestXifan('/rest/v1/rpc/get_anime_detail', {
      p_id: Number(animeId),
    }),
  );
  const result = toSearchResult(apiSite, data.anime);
  if (!result || result.id !== animeId || !Array.isArray(data.sources)) {
    throw new Error('稀饭详情响应无效');
  }
  // 仅接入已验证可直连的备用线路，避免自动换回不通的主线。
  const source = data.sources
    .map(object)
    .find((item) => item.code === BACKUP_SOURCE_CODE);
  if (!source || !Array.isArray(source.episodes) || !source.episodes.length) {
    throw new Error('稀饭备用线路暂无剧集');
  }
  const sourceId = positiveId(source.id);
  const episodes = source.episodes.map(object);
  for (const episode of episodes) {
    const episodeId = positiveId(episode.id);
    result.episodes.push(
      buildLazyEpisodeUrl(
        'xifan',
        `/anime/${animeId}/episode/${episodeId}/source/${sourceId}`,
      ),
    );
    const number = episode.episode_number;
    // 明确集号供换源与观看进度匹配；特别篇保留原名。
    result.episodes_titles.push(
      episode.kind === 'main' &&
        typeof number === 'number' &&
        Number.isInteger(number) &&
        number > 0
        ? `第${number}集`
        : text(episode.title) || `第${result.episodes.length}集`,
    );
  }
  return result;
}

export async function resolveXifanEpisodeUrlByPath(
  _apiSite: ApiSite,
  path: string,
): Promise<string> {
  const match =
    /^\/anime\/([1-9]\d*)\/episode\/([1-9]\d*)\/source\/([1-9]\d*)$/.exec(path);
  if (
    !match ||
    !match.slice(1).every((id) => Number.isSafeInteger(Number(id)))
  ) {
    throw new Error('无效的稀饭集数地址');
  }
  const [, , episodeId, sourceId] = match;
  const data = object(
    await requestXifan('/functions/v1/issue-web-playback', {
      action: 'fallback',
      episode_id: Number(episodeId),
      source_id: Number(sourceId),
    }),
  );
  const candidate =
    data.ok === true && Array.isArray(data.candidates)
      ? data.candidates
          .map(object)
          .find(
            (item) =>
              item.source_code === BACKUP_SOURCE_CODE &&
              String(item.source_id) === sourceId,
          )
      : undefined;
  if (!candidate || typeof candidate.url !== 'string') {
    throw new Error('稀饭备用播放地址不可用');
  }
  const url = new URL(candidate.url);
  if (!/^https?:$/.test(url.protocol) || !/\.(m3u8|mp4)$/i.test(url.pathname)) {
    throw new Error('稀饭返回的播放地址无效');
  }
  const validation = await validateProxyUrlForRequest(url.href);
  if (!validation.ok) throw new Error('稀饭播放地址不可用');
  return validation.url;
}
