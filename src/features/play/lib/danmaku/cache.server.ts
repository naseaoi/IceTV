import 'server-only';

import {
  DANMAKU_COMMENTS_FRESH_MS,
  DANMAKU_COMMENTS_STALE_MS,
  DANMAKU_EMPTY_CACHE_MS,
  DANMAKU_SEARCH_FRESH_MS,
  DANMAKU_SEARCH_STALE_MS,
} from '@/features/play/lib/danmaku/cache-policy';
import {
  fetchDanmakuByEpisodeId,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/provider.server';
import {
  type DanmakuFetchResult,
  type DanmakuMatchCandidate,
  DanmakuProviderError,
} from '@/features/play/lib/danmaku/types';
import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import { createSwrCache } from '@/lib/server-cache';

class EmptyDanmakuRefreshError extends Error {}

export const danmakuCommentsCache = createSwrCache<DanmakuFetchResult>({
  name: 'danmaku-comments',
  freshMs: DANMAKU_COMMENTS_FRESH_MS,
  staleMs: DANMAKU_COMMENTS_STALE_MS,
  getTtl: (result) =>
    result.items.length === 0
      ? { freshMs: DANMAKU_EMPTY_CACHE_MS, staleMs: 0 }
      : {
          freshMs: DANMAKU_COMMENTS_FRESH_MS,
          staleMs: DANMAKU_COMMENTS_STALE_MS,
        },
  ...getServerCacheBudget('danmaku-comments'),
});

export const danmakuSearchCache = createSwrCache<DanmakuMatchCandidate[]>({
  name: 'danmaku-search',
  freshMs: DANMAKU_SEARCH_FRESH_MS,
  staleMs: DANMAKU_SEARCH_STALE_MS,
  getTtl: (candidates) =>
    candidates.length === 0
      ? { freshMs: DANMAKU_EMPTY_CACHE_MS, staleMs: 0 }
      : { freshMs: DANMAKU_SEARCH_FRESH_MS, staleMs: DANMAKU_SEARCH_STALE_MS },
  ...getServerCacheBudget('danmaku-search'),
});

async function validateEpisodeTitle(
  episodeId: number,
  keyword: string,
): Promise<void> {
  const candidates = await danmakuSearchCache.refresh(keyword, () =>
    searchDanmakuCandidates(keyword),
  );
  if (candidates.length === 0) {
    throw new DanmakuProviderError(
      'upstream-unavailable',
      '暂时无法校验弹幕绑定',
    );
  }
  if (!candidates.some((candidate) => candidate.episodeId === episodeId)) {
    throw new DanmakuProviderError(
      'episode-not-found',
      '弹幕集数不属于当前标题',
    );
  }
}

export async function getCachedDanmakuComments(
  episodeId: number,
  limit: number,
  refresh = false,
  keyword = '',
): Promise<DanmakuFetchResult> {
  const key = keyword
    ? JSON.stringify([episodeId, limit, keyword])
    : `${episodeId}:${limit}`;
  const load = async () => {
    try {
      if (keyword) await validateEpisodeTitle(episodeId, keyword);
      const result = await fetchDanmakuByEpisodeId(episodeId, limit);
      if (
        result.items.length === 0 &&
        danmakuCommentsCache.peek(key)?.value.items.length
      ) {
        throw new EmptyDanmakuRefreshError();
      }
      return result;
    } catch (error) {
      if (
        error instanceof DanmakuProviderError &&
        error.kind === 'episode-not-found'
      ) {
        danmakuCommentsCache.invalidate(key);
      }
      throw error;
    }
  };

  try {
    return await (refresh
      ? danmakuCommentsCache.refresh(key, load)
      : danmakuCommentsCache.getOrLoad(key, load));
  } catch (error) {
    if (
      error instanceof DanmakuProviderError &&
      error.kind === 'episode-not-found'
    ) {
      danmakuCommentsCache.invalidate(key);
    }
    const previous = danmakuCommentsCache.peek(key)?.value;
    if (
      previous?.items.length &&
      (error instanceof EmptyDanmakuRefreshError ||
        (error instanceof DanmakuProviderError &&
          error.kind !== 'episode-not-found' &&
          error.kind !== 'not-configured'))
    ) {
      return previous;
    }
    throw error;
  }
}

export function getDanmakuCommentsCacheStats() {
  return danmakuCommentsCache.stats();
}

export function getDanmakuSearchCacheStats() {
  return danmakuSearchCache.stats();
}
