import {
  type DanmakuFetchResult,
  type DanmakuItem,
  type DanmakuMatchCandidate,
  DanmakuEpisodeNotFoundError,
} from '@/features/play/lib/danmaku/types';

// 标题形如「【bilibili1】 第22话 魔道争锋1」，来源标签和尾缀都带数字
const EPISODE_ORDINAL_PATTERN = /第\s*(\d{1,4})\s*[集话期]/;
const SOURCE_TAG_PATTERN = /【[^】]*】/g;
const FALLBACK_NUMBER_PATTERN = /(\d{1,4})/;
const PROVIDER_SUFFIX_PATTERN = /\s*from\s+(\S+)\s*$/i;
const YEAR_PATTERN = /(?:19|20)\d{2}/g;
const YEAR_TOKEN_PATTERN = /(?:19|20)\d{2}/;
const TITLE_PUNCTUATION_PATTERN =
  /[\s\u3000:：·・,，。.!！？?、'"“”‘’「」『』《》〈〉()（）[\]{}\-—_]/g;
const SEARCH_WARMUP_TTL_MS = 30 * 60 * 1000;
const SEARCH_WARMUP_MAX = 12;
const COMMENTS_WARMUP_TTL_MS = 60 * 1000;
const COMMENTS_WARMUP_MAX = 4;

interface DanmakuSearchCacheEntry {
  expiresAt: number;
  promise: Promise<DanmakuMatchCandidate[]>;
}

interface DanmakuCommentsCacheEntry {
  expiresAt: number;
  promise: Promise<DanmakuItem[]>;
}

const danmakuSearchCache = new Map<string, DanmakuSearchCacheEntry>();
const danmakuCommentsCache = new Map<number, DanmakuCommentsCacheEntry>();

function normalizeSearchCacheKey(keyword: string): string {
  return keyword.trim().replace(/\s+/g, ' ').toLowerCase();
}

function trimSearchCache(): void {
  while (danmakuSearchCache.size > SEARCH_WARMUP_MAX) {
    const oldest = danmakuSearchCache.keys().next().value;
    if (!oldest) return;
    danmakuSearchCache.delete(oldest);
  }
}

function trimCommentsCache(): void {
  while (danmakuCommentsCache.size > COMMENTS_WARMUP_MAX) {
    const oldest = danmakuCommentsCache.keys().next().value;
    if (oldest === undefined) return;
    danmakuCommentsCache.delete(oldest);
  }
}

async function requestDanmakuCandidates(
  keyword: string,
  signal?: AbortSignal,
  force = false,
): Promise<DanmakuMatchCandidate[]> {
  const response = await fetch(
    `/api/danmaku/search?keyword=${encodeURIComponent(keyword)}${force ? '&refresh=1' : ''}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(`弹幕搜索请求失败: ${response.status}`);
  }

  const payload = (await response.json()) as {
    candidates?: DanmakuMatchCandidate[];
  };
  return Array.isArray(payload.candidates) ? payload.candidates : [];
}

export function searchDanmakuCandidates(
  keyword: string,
  signal?: AbortSignal,
  options: { force?: boolean } = {},
): Promise<DanmakuMatchCandidate[]> {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) return Promise.resolve([]);
  if (signal)
    return requestDanmakuCandidates(normalizedKeyword, signal, options.force);

  const key = normalizeSearchCacheKey(normalizedKeyword);
  const now = Date.now();
  const cached = danmakuSearchCache.get(key);
  if (!options.force && cached && cached.expiresAt > now) return cached.promise;
  if (cached) danmakuSearchCache.delete(key);

  const promise = requestDanmakuCandidates(
    normalizedKeyword,
    undefined,
    options.force,
  ).catch((error) => {
    if (danmakuSearchCache.get(key)?.promise === promise) {
      danmakuSearchCache.delete(key);
    }
    throw error;
  });
  danmakuSearchCache.set(key, {
    expiresAt: now + SEARCH_WARMUP_TTL_MS,
    promise,
  });
  trimSearchCache();
  return promise;
}

export function warmupDanmakuSearch(keyword: string): void {
  void searchDanmakuCandidates(keyword).catch(() => {});
}

async function requestDanmakuComments(
  episodeId: number,
  signal?: AbortSignal,
  force = false,
): Promise<DanmakuItem[]> {
  const refresh = force ? '&refresh=1' : '';
  const response = await fetch(
    `/api/danmaku/comments?episodeId=${episodeId}${refresh}`,
    { signal },
  );
  if (!response.ok) {
    if (response.status === 404) {
      const payload = await response.json().catch(() => null);
      if (payload?.code === 'DANMAKU_EPISODE_NOT_FOUND') {
        throw new DanmakuEpisodeNotFoundError();
      }
    }
    throw new Error(`弹幕评论请求失败: ${response.status}`);
  }

  const payload = (await response.json()) as Partial<DanmakuFetchResult>;
  // 服务端已按后台 DanmakuEpisodeLimit 完成抽稀，客户端直接保留完整返回队列。
  return Array.isArray(payload.items) ? payload.items : [];
}

export function fetchDanmakuComments(
  episodeId: number,
  signal?: AbortSignal,
  options: { force?: boolean } = {},
): Promise<DanmakuItem[]> {
  if (signal) {
    return requestDanmakuComments(episodeId, signal, options.force);
  }

  const now = Date.now();
  const cached = danmakuCommentsCache.get(episodeId);
  if (!options.force && cached && cached.expiresAt > now) {
    return cached.promise;
  }
  if (cached) danmakuCommentsCache.delete(episodeId);

  const promise = requestDanmakuComments(episodeId).catch((error) => {
    if (danmakuCommentsCache.get(episodeId)?.promise === promise) {
      danmakuCommentsCache.delete(episodeId);
    }
    throw error;
  });
  danmakuCommentsCache.set(episodeId, {
    expiresAt: now + COMMENTS_WARMUP_TTL_MS,
    promise,
  });
  trimCommentsCache();
  return promise;
}

export interface DanmakuSourceGroup {
  animeTitle: string;
  providerLabel: string | null;
  displayTitle: string;
  typeDescription?: string;
  candidates: DanmakuMatchCandidate[];
}

// 源标题形如「凡人修仙传(2025)【国产剧】from youku」，尾部提供方单独作标签展示
export function splitSourceProvider(animeTitle: string): {
  providerLabel: string | null;
  displayTitle: string;
} {
  const matched = animeTitle.match(PROVIDER_SUFFIX_PATTERN);
  if (!matched) return { providerLabel: null, displayTitle: animeTitle };

  const displayTitle = animeTitle.replace(PROVIDER_SUFFIX_PATTERN, '').trim();
  if (!displayTitle) return { providerLabel: null, displayTitle: animeTitle };

  return { providerLabel: matched[1], displayTitle };
}

// 候选是多源轮转排列的，按源归并后每组内部恢复原始集顺序
export function groupCandidatesBySource(
  candidates: DanmakuMatchCandidate[],
): DanmakuSourceGroup[] {
  const groups = new Map<string, DanmakuSourceGroup>();
  for (const candidate of candidates) {
    const existing = groups.get(candidate.animeTitle);
    if (existing) {
      existing.candidates.push(candidate);
      continue;
    }
    groups.set(candidate.animeTitle, {
      animeTitle: candidate.animeTitle,
      ...splitSourceProvider(candidate.animeTitle),
      typeDescription: candidate.typeDescription,
      candidates: [candidate],
    });
  }
  return Array.from(groups.values());
}

function normalizeDanmakuTitle(value: string): string {
  return value
    .replace(PROVIDER_SUFFIX_PATTERN, '')
    .replace(SOURCE_TAG_PATTERN, '')
    .replace(/[（(]\s*(?:19|20)\d{2}\s*[）)]/g, '')
    .replace(YEAR_PATTERN, '')
    .replace(TITLE_PUNCTUATION_PATTERN, '')
    .toLowerCase();
}

function extractTitleYear(value: string): string | null {
  return value.match(YEAR_TOKEN_PATTERN)?.[0] ?? null;
}

function scoreCandidateTitle(
  animeTitle: string,
  searchTitle: string,
  searchYear: string,
): number {
  const normalizedSearchTitle = normalizeDanmakuTitle(searchTitle);
  if (!normalizedSearchTitle) return 0;

  const normalizedCandidateTitle = normalizeDanmakuTitle(animeTitle);
  let score = 0;
  if (normalizedCandidateTitle === normalizedSearchTitle) {
    score = 100;
  } else if (
    normalizedCandidateTitle.includes(normalizedSearchTitle) ||
    normalizedSearchTitle.includes(normalizedCandidateTitle)
  ) {
    score = 50;
  }

  const normalizedYear = extractTitleYear(searchYear);
  if (score > 0 && normalizedYear === extractTitleYear(animeTitle)) {
    score += 20;
  }
  return score;
}

export function extractEpisodeNumber(title: string): number | null {
  const ordinal = title.match(EPISODE_ORDINAL_PATTERN);
  if (ordinal) {
    const parsed = Number.parseInt(ordinal[1], 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  const withoutTags = title.replace(SOURCE_TAG_PATTERN, ' ');
  const fallback = withoutTags.match(FALLBACK_NUMBER_PATTERN);
  if (!fallback) return null;

  const parsed = Number.parseInt(fallback[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// 自动匹配只做首次猜测，命中不准由手动选集兜底
export function rankCandidatesByEpisode(
  candidates: DanmakuMatchCandidate[],
  episodeIndex: number,
  searchTitle = '',
  searchYear = '',
): DanmakuMatchCandidate[] {
  if (candidates.length === 0) return [];

  const targetEpisode = episodeIndex + 1;
  const ranked: DanmakuMatchCandidate[] = [];
  const seen = new Set<number>();
  const append = (candidate: DanmakuMatchCandidate | undefined) => {
    if (!candidate || seen.has(candidate.episodeId)) return;
    seen.add(candidate.episodeId);
    ranked.push(candidate);
  };

  // 搜索结果可能同时包含同名的不同季度/特别篇，先按标题和年份选源，
  // 再在选中的源内按集号匹配，避免把其他系列的第 1 集误绑进来。
  if (searchTitle.trim()) {
    const scoredGroups = groupCandidatesBySource(candidates)
      .map((group, index) => ({
        group,
        index,
        score: scoreCandidateTitle(group.animeTitle, searchTitle, searchYear),
      }))
      .sort(
        (left, right) => right.score - left.score || left.index - right.index,
      );
    const bestScore = scoredGroups[0]?.score ?? 0;
    const rankedGroups = scoredGroups.filter(
      (entry) => entry.score > 0 && entry.score === bestScore,
    );

    for (const { group } of rankedGroups) {
      group.candidates
        .filter(
          (candidate) =>
            extractEpisodeNumber(candidate.episodeTitle) === targetEpisode,
        )
        .forEach(append);
    }

    for (const { group } of rankedGroups) {
      const byIndex = group.candidates[episodeIndex];
      append(byIndex);
    }

    if (rankedGroups.length > 0) return ranked;
  }

  for (const candidate of candidates) {
    if (extractEpisodeNumber(candidate.episodeTitle) === targetEpisode) {
      append(candidate);
    }
  }

  // 在首个源内按位置兜底
  const firstSource = candidates[0].animeTitle;
  const sameSource = candidates.filter(
    (candidate) => candidate.animeTitle === firstSource,
  );
  append(sameSource[episodeIndex]);
  return ranked;
}

export function pickCandidateByEpisode(
  candidates: DanmakuMatchCandidate[],
  episodeIndex: number,
  searchTitle = '',
  searchYear = '',
): DanmakuMatchCandidate | null {
  return (
    rankCandidatesByEpisode(
      candidates,
      episodeIndex,
      searchTitle,
      searchYear,
    )[0] ?? null
  );
}
