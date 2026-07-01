import { defaultCache } from '@serwist/next/worker';
import {
  CacheFirst,
  CacheableResponsePlugin,
  ExpirationPlugin,
  Serwist,
  StaleWhileRevalidate,
} from 'serwist';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';

import {
  excludeDefaultApiRuntimeCache,
  shouldHandleBangumiCoverCache,
  shouldHandleExternalCoverCache,
  shouldHandleImageProxyCache,
  shouldHandleNextImageCache,
  shouldHandleVodSegmentCache,
} from './lib/sw-cache-rules';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const defaultRuntimeCache = excludeDefaultApiRuntimeCache(defaultCache);
const VOD_SEGMENT_CACHE_NAME = 'vod-segment-cache';
const VOD_SEGMENT_MAX_ENTRIES = 128;
const VOD_SEGMENT_MAX_AGE_SECONDS = 3 * 24 * 60 * 60;
const VOD_SEGMENT_MAX_TOTAL_BYTES = 384 * 1024 * 1024;
const VOD_SEGMENT_MAX_SINGLE_BYTES = 32 * 1024 * 1024;
const VOD_SEGMENT_MIN_FREE_BYTES = 256 * 1024 * 1024;
const VOD_SEGMENT_STORAGE_PRESSURE_RATIO = 0.8;

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

async function trimVodSegmentCache(incomingBytes: number) {
  const cache = await caches.open(VOD_SEGMENT_CACHE_NAME);
  const requests = await cache.keys();
  let totalBytes = 0;
  const entries: { request: Request; bytes: number }[] = [];

  for (const request of requests) {
    const response = await cache.match(request);
    const bytes = readContentLength(response);
    if (bytes === null) {
      await cache.delete(request);
      continue;
    }
    totalBytes += bytes;
    entries.push({ request, bytes });
  }

  while (
    totalBytes + incomingBytes > VOD_SEGMENT_MAX_TOTAL_BYTES &&
    entries.length > 0
  ) {
    const entry = entries.shift()!;
    await cache.delete(entry.request);
    totalBytes -= entry.bytes;
  }
}

const vodSegmentStoragePlugin = {
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

    await trimVodSegmentCache(incomingBytes);
    return response;
  },
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Serwist 提供的 Next.js 默认缓存策略（静态资源、页面路由等）
    ...defaultRuntimeCache,
    // next/image 缓存（视频墙一次可铺满，放宽条目上限）
    {
      matcher: ({ url }) =>
        shouldHandleNextImageCache({
          pathname: url.pathname,
          search: url.search,
        }),
      handler: new CacheFirst({
        cacheName: 'next-image-cache',
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 1024,
            maxAgeSeconds: 30 * 24 * 60 * 60,
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
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 1024,
            maxAgeSeconds: 30 * 24 * 60 * 60,
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
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 600,
            maxAgeSeconds: 30 * 24 * 60 * 60,
            purgeOnQuotaError: true,
          }),
        ],
      }),
    },
    // 豆瓣外部图片缓存
    {
      matcher: ({ url }) =>
        shouldHandleExternalCoverCache({ hostname: url.hostname }),
      handler: new CacheFirst({
        cacheName: 'external-cover-cache',
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 1024,
            maxAgeSeconds: 14 * 24 * 60 * 60,
          }),
        ],
      }),
    },
    // 只读 JSON API SWR 缓存（弱网/离线体验 & 二次访问秒开）
    // 仅缓存 GET，且排除带鉴权语义的管理接口
    {
      matcher: ({ url, request, sameOrigin }) =>
        sameOrigin &&
        request.method === 'GET' &&
        /^\/api\/(detail|search\/suggestions|douban(\/(categories|recommends))?)(\/|$|\?)/.test(
          url.pathname,
        ),
      handler: new StaleWhileRevalidate({
        cacheName: 'json-api-cache',
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({
            maxEntries: 512,
            // 和服务端 s-maxage 语义对齐，短 TTL 即可，SWR 会后台刷新
            maxAgeSeconds: 60 * 60,
          }),
        ],
      }),
    },
    // VOD 分片缓存：跨会话复用点播片段
    // - 仅 GET；显式带 icetv-live=1 的（直播分片）不缓存
    // - 分片文件较大，maxEntries 保守限定 512，按 LRU 淘汰；7 天过期
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
  ],
});

serwist.addEventListeners();
