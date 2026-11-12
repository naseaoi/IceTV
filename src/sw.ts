import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import {
  CacheableResponsePlugin,
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  Serwist,
} from 'serwist';

import { createCacheBudgetLedger } from './lib/cache-budget';
import { normalizeSegmentCacheKey } from './lib/segment-cache-key';
import {
  composeRuntimeCaching,
  shouldBypassCrossOriginImageCache,
  shouldHandleBangumiCoverCache,
  shouldHandleImageProxyCache,
  shouldHandleVodSegmentCache,
} from './lib/sw-cache-rules';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const VOD_SEGMENT_CACHE_NAME = 'vod-segment-cache';
const VOD_SEGMENT_MAX_ENTRIES = 128;
const VOD_SEGMENT_MAX_AGE_SECONDS = 3 * 24 * 60 * 60;
const VOD_SEGMENT_MAX_TOTAL_BYTES = 384 * 1024 * 1024;
const VOD_SEGMENT_MAX_SINGLE_BYTES = 32 * 1024 * 1024;
const VOD_SEGMENT_MIN_FREE_BYTES = 256 * 1024 * 1024;
const VOD_SEGMENT_STORAGE_PRESSURE_RATIO = 0.8;
const vodSegmentBudget = createCacheBudgetLedger<string>({
  maxEntries: VOD_SEGMENT_MAX_ENTRIES,
  maxBytes: VOD_SEGMENT_MAX_TOTAL_BYTES,
});
let vodSegmentBudgetQueue: Promise<void> = Promise.resolve();

function readContentLength(response: Response | undefined): number | null {
  if (!response) {
    return null;
  }

  const value = Number.parseInt(
    response.headers.get('content-length') || '',
    10,
  );
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function hasStoragePressure(incomingBytes: number): Promise<boolean> {
  if (!navigator.storage?.estimate) {
    return false;
  }

  const estimate = await navigator.storage.estimate();
  const quota = estimate.quota || 0;
  const usage = estimate.usage || 0;
  if (!quota) {
    return false;
  }

  return (
    usage + incomingBytes > quota * VOD_SEGMENT_STORAGE_PRESSURE_RATIO ||
    quota - usage < VOD_SEGMENT_MIN_FREE_BYTES
  );
}

async function initializeVodSegmentBudget(): Promise<Cache> {
  const cache = await caches.open(VOD_SEGMENT_CACHE_NAME);
  if (vodSegmentBudget.isInitialized()) return cache;

  const requests = await cache.keys();
  const entries: { key: string; bytes: number }[] = [];

  for (const request of requests) {
    const response = await cache.match(request);
    const bytes = readContentLength(response);
    if (bytes === null) {
      await cache.delete(request);
      continue;
    }
    entries.push({ key: request.url, bytes });
  }

  vodSegmentBudget.initialize(entries);
  return cache;
}

function updateVodSegmentBudget<T>(task: () => Promise<T>): Promise<T> {
  const result = vodSegmentBudgetQueue.then(task, task);
  vodSegmentBudgetQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function reserveVodSegmentCache(
  cacheKey: string,
  incomingBytes: number,
): Promise<void> {
  await updateVodSegmentBudget(async () => {
    const cache = await initializeVodSegmentBudget();
    const evictedUrls = vodSegmentBudget.reserve(cacheKey, incomingBytes);
    await Promise.all(evictedUrls.map((url) => cache.delete(url)));
  });
}

const vodSegmentStoragePlugin = {
  // 返回字符串让 Serwist 生成不带请求头的键，读、写与账本 cache.delete(url) 三处匹配一致，不受响应 Vary 影响
  cacheKeyWillBeUsed({ request }: { request: Request }) {
    return normalizeSegmentCacheKey(request.url);
  },
  async cacheWillUpdate({
    request,
    response,
  }: {
    request: Request;
    response: Response | null;
  }) {
    if (!response || response.status !== 200 || request.headers.has('range')) {
      return null;
    }

    const incomingBytes = readContentLength(response);
    if (
      incomingBytes === null ||
      incomingBytes > VOD_SEGMENT_MAX_SINGLE_BYTES ||
      (await hasStoragePressure(incomingBytes))
    ) {
      return null;
    }

    // Serwist 传给 cacheWillUpdate 的是原始请求而非 cacheKeyWillBeUsed 的结果，账本须自行归一化，淘汰时才删得到真实条目
    await reserveVodSegmentCache(
      normalizeSegmentCacheKey(request.url),
      incomingBytes,
    );
    return response;
  },
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: composeRuntimeCaching(
    [
      // 先于默认的跨域 NetworkFirst 规则拦下跨域图片，不写入 Cache Storage
      {
        matcher: ({ request, sameOrigin }) =>
          shouldBypassCrossOriginImageCache({
            sameOrigin,
            destination: request.destination,
          }),
        handler: new NetworkOnly(),
      },
      // VOD 分片缓存：跨会话复用点播片段
      // - 仅 GET；直播分片（icetv-live=1）与 Range 请求不缓存
      // - 缓存键剔除签名与切换标记，同一分片换清单后仍能命中
      // - 条目数、总字节、单片大小与过期时间见 VOD_SEGMENT_* 常量，超额时按写入先后淘汰
      {
        matcher: ({ url, request, sameOrigin }) =>
          shouldHandleVodSegmentCache({
            sameOrigin,
            method: request.method,
            pathname: url.pathname,
            liveFlag: url.searchParams.get('icetv-live'),
            hasRangeHeader: request.headers.has('range'),
          }),
        handler: new CacheFirst({
          cacheName: VOD_SEGMENT_CACHE_NAME,
          plugins: [
            vodSegmentStoragePlugin,
            new CacheableResponsePlugin({ statuses: [200] }),
            new ExpirationPlugin({
              maxEntries: VOD_SEGMENT_MAX_ENTRIES,
              maxAgeSeconds: VOD_SEGMENT_MAX_AGE_SECONDS,
            }),
          ],
        }),
      },
      // 封面代理缓存
      {
        matcher: ({ url }) =>
          shouldHandleImageProxyCache({
            pathname: url.pathname,
            search: url.search,
          }),
        handler: new CacheFirst({
          cacheName: 'cover-proxy-cache',
          plugins: [
            new CacheableResponsePlugin({ statuses: [200] }),
            new ExpirationPlugin({
              maxEntries: 1024,
              maxAgeSeconds: 30 * 24 * 60 * 60,
              purgeOnQuotaError: true,
            }),
          ],
        }),
      },
      // Bangumi 封面代理缓存
      {
        matcher: ({ url }) =>
          shouldHandleBangumiCoverCache({
            pathname: url.pathname,
          }),
        handler: new CacheFirst({
          cacheName: 'bangumi-cover-cache',
          plugins: [
            new CacheableResponsePlugin({ statuses: [200] }),
            new ExpirationPlugin({
              maxEntries: 600,
              maxAgeSeconds: 30 * 24 * 60 * 60,
              purgeOnQuotaError: true,
            }),
          ],
        }),
      },
    ],
    defaultCache,
  ),
});

serwist.addEventListeners();
