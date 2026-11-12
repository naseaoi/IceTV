import 'server-only';

import { getServerCacheBudget } from '@/lib/cache-budget-profile';
import { waitForSharedLoad } from '@/lib/concurrency';
import type { ApiSite } from '@/lib/config';
import { createSwrCache } from '@/lib/server-cache';
import { createSharedServerCache } from '@/lib/shared-server-cache';
import { hasSignedUrlParams } from '@/lib/signed-url-params';
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
const signedEpisodeUrls = createSwrCache<string>({
  name: 'episode-url-signed',
  ...EPISODE_URL_TTL,
  ...getServerCacheBudget('episode-url'),
});

export const episodeUrlCache = {
  getOrLoad(
    key: string,
    loader: () => Promise<string>,
    signal?: AbortSignal,
  ): Promise<string> {
    if (signedEpisodeUrls.peek(key))
      return signedEpisodeUrls.getOrLoad(key, loader);
    return waitForSharedLoad(
      () =>
        sharedEpisodeUrls.getOrLoad(key, async () => {
          const url = await loader();
          if (hasSignedUrlParams(url)) signedEpisodeUrls.set(key, url);
          return url;
        }),
      signal,
    );
  },
  set(key: string, url: string) {
    if (hasSignedUrlParams(url)) signedEpisodeUrls.set(key, url);
    else sharedEpisodeUrls.set(key, url);
  },
  clear() {
    sharedEpisodeUrls.clear();
    signedEpisodeUrls.clear();
  },
};

export function getEpisodeUrlCacheStats() {
  const shared = sharedEpisodeUrls.stats();
  const signed = signedEpisodeUrls.stats();
  return {
    ...shared,
    size: shared.size + signed.size,
    estimatedBytes: shared.estimatedBytes + signed.estimatedBytes,
    hits: shared.hits + signed.hits,
    misses: shared.misses + signed.misses,
  };
}
