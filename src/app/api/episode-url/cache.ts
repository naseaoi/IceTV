import 'server-only';

import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import { waitForSharedLoad } from '@/lib/concurrency';
import type { ApiSite } from '@/lib/config';
import { createSwrCache } from '@/lib/server-cache';
import { createSharedServerCache } from '@/lib/shared-server-cache';
import {
  getSignedUrlFreshMs,
  hasSignedUrlParams,
} from '@/lib/signed-url-params';
import { getSourceCacheKey } from '@/lib/source-cache-key';

const EPISODE_URL_TTL = {
  freshMs: 30 * 60 * 1000,
  staleMs: 2 * 60 * 60 * 1000,
};

export function getEpisodeUrlCacheKey(apiSite: ApiSite, lazyUrl: string) {
  return JSON.stringify([getSourceCacheKey(apiSite), lazyUrl]);
}

// 带签名参数的地址可能绑定出口或短期过期，只留在本实例；解析逻辑改变结果时升级共享缓存名的版本
const sharedEpisodeUrls = createSharedServerCache<string>({
  name: 'episode-url-v1',
  ...EPISODE_URL_TTL,
  ...getServerCacheBudget('episode-url'),
  shouldCache: (url) => !hasSignedUrlParams(url),
});
const localEpisodeUrls = createSwrCache<string>({
  name: 'episode-url-local',
  freshMs: EPISODE_URL_TTL.freshMs,
  staleMs: 0,
  getTtl: (url) => ({
    freshMs: hasSignedUrlParams(url)
      ? getSignedUrlFreshMs(url)
      : EPISODE_URL_TTL.freshMs,
  }),
  ...getServerCacheBudget('episode-url'),
});

const refreshInflight = new Map<string, Promise<string>>();

export const episodeUrlCache = {
  getOrLoad(
    key: string,
    loader: () => Promise<string>,
    signal?: AbortSignal,
  ): Promise<string> {
    return waitForSharedLoad(async () => {
      const refreshing = refreshInflight.get(key);
      if (refreshing) return refreshing;
      const local = localEpisodeUrls.peek(key);
      if (local) return local.value;
      return sharedEpisodeUrls.getOrLoad(key, async () => {
        const url = await loader();
        if (
          hasSignedUrlParams(url) &&
          !refreshInflight.has(key) &&
          !localEpisodeUrls.peek(key)
        )
          localEpisodeUrls.set(key, url);
        return url;
      });
    }, signal);
  },
  refresh(
    key: string,
    loader: () => Promise<string>,
    signal?: AbortSignal,
  ): Promise<string> {
    return waitForSharedLoad(() => {
      const existing = refreshInflight.get(key);
      if (existing) return existing;
      const task = Promise.resolve()
        .then(loader)
        .then((url) => {
          // 强刷结果作为本实例优先值，旧的共享加载完成后不能覆盖它。
          if (refreshInflight.get(key) === task) localEpisodeUrls.set(key, url);
          return url;
        })
        .finally(() => {
          if (refreshInflight.get(key) === task) refreshInflight.delete(key);
        });
      refreshInflight.set(key, task);
      return task;
    }, signal);
  },
  set(key: string, url: string) {
    if (hasSignedUrlParams(url)) localEpisodeUrls.set(key, url);
    else sharedEpisodeUrls.set(key, url);
  },
  clear() {
    refreshInflight.clear();
    sharedEpisodeUrls.clear();
    localEpisodeUrls.clear();
  },
};

export function getEpisodeUrlCacheStats() {
  const shared = sharedEpisodeUrls.stats();
  const local = localEpisodeUrls.stats();
  return {
    ...shared,
    size: shared.size + local.size,
    estimatedBytes: shared.estimatedBytes + local.estimatedBytes,
    hits: shared.hits + local.hits,
    misses: shared.misses + local.misses,
  };
}
