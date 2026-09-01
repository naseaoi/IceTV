import 'server-only';

import { normalizeComments } from '@/features/play/lib/danmaku/normalize';
import {
  type DanmakuFetchResult,
  type DanmakuMatchCandidate,
  DanmakuProviderError,
} from '@/features/play/lib/danmaku/types';
import { fetchWithUrlGuard, UrlValidationError } from '@/lib/url-guard';

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

// danmu_api 的 base 形如 https://host/{token}，token 在路径里
function readBaseUrl(): string | null {
  const raw = (process.env.DANMAKU_API_BASE_URL || '').trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

export function isDanmakuProviderConfigured(): boolean {
  return readBaseUrl() !== null;
}

function requireBaseUrl(): string {
  const base = readBaseUrl();
  if (!base) {
    throw new DanmakuProviderError(
      'not-configured',
      'DANMAKU_API_BASE_URL 未配置',
    );
  }
  return base;
}

// 内网自建服务需显式放行，否则 url-guard 会拦私有地址
function allowsPrivateTarget(): boolean {
  return process.env.DANMAKU_API_ALLOW_PRIVATE === 'true';
}

// base 来自环境变量属可信输入，用户输入只进 query 且经编码
function buildUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${requireBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function requestUpstream(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const init = {
    cache: 'no-store' as const,
    headers: { Accept: 'application/json' },
  };

  if (allowsPrivateTarget()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  return fetchWithUrlGuard(url, { ...init, timeoutMs });
}

async function readJson(url: string, timeoutMs: number): Promise<unknown> {
  let response: Response;
  try {
    response = await requestUpstream(url, timeoutMs);
  } catch (error) {
    if (error instanceof UrlValidationError) {
      throw new DanmakuProviderError(
        'upstream-rejected',
        `弹幕服务地址被安全校验拦截（${error.reason}）。内网地址需设置 DANMAKU_API_ALLOW_PRIVATE=true`,
      );
    }
    throw new DanmakuProviderError(
      'upstream-unavailable',
      error instanceof Error ? error.message : '弹幕服务请求失败',
    );
  }

  if (!response.ok) {
    throw new DanmakuProviderError(
      'upstream-rejected',
      `弹幕服务返回 ${response.status}`,
    );
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new DanmakuProviderError('invalid-response', '弹幕数据超出体积上限');
  }

  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new DanmakuProviderError('invalid-response', '弹幕数据超出体积上限');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DanmakuProviderError('invalid-response', '弹幕服务返回非 JSON');
  }
}

type SearchResponse = {
  animes?: {
    animeTitle?: unknown;
    typeDescription?: unknown;
    episodes?: { episodeId?: unknown; episodeTitle?: unknown }[];
  }[];
};

// search/anime 只给 animeId 不给 episodeId，必须走 search/episodes（参数名是 anime）
export async function searchDanmakuCandidates(
  keyword: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DanmakuMatchCandidate[]> {
  const payload = (await readJson(
    buildUrl('/api/v2/search/episodes', { anime: keyword }),
    timeoutMs,
  )) as SearchResponse;

  if (!payload || !Array.isArray(payload.animes)) {
    return [];
  }

  const candidates: DanmakuMatchCandidate[] = [];
  for (const anime of payload.animes) {
    const animeTitle =
      typeof anime?.animeTitle === 'string' ? anime.animeTitle : '';
    const episodes = Array.isArray(anime?.episodes) ? anime.episodes : [];
    for (const episode of episodes) {
      const episodeId = Number(episode?.episodeId);
      if (!Number.isSafeInteger(episodeId) || episodeId <= 0) continue;
      candidates.push({
        episodeId,
        animeTitle,
        episodeTitle:
          typeof episode?.episodeTitle === 'string' ? episode.episodeTitle : '',
        typeDescription:
          typeof anime?.typeDescription === 'string'
            ? anime.typeDescription
            : undefined,
      });
    }
  }
  return candidates;
}

type CommentResponse = { comments?: unknown };

export async function fetchDanmakuByEpisodeId(
  episodeId: number,
  limit: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DanmakuFetchResult> {
  const payload = (await readJson(
    buildUrl(`/api/v2/comment/${episodeId}`, { format: 'json' }),
    timeoutMs,
  )) as CommentResponse;

  return normalizeComments(payload?.comments, limit);
}
