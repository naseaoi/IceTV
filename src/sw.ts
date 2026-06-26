import { defaultCache } from '@serwist/next/worker';
import {
  CacheFirst,
  CacheableResponsePlugin,
  ExpirationPlugin,
  Serwist,
  StaleWhileRevalidate,
} from 'serwist';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';

import { excludeDefaultApiRuntimeCache } from './lib/sw-cache-rules';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const defaultRuntimeCache = excludeDefaultApiRuntimeCache(defaultCache);

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
        /^\/_next\/image\?url=.+$/.test(url.pathname + url.search),
      handler: new StaleWhileRevalidate({
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
        /^\/api\/image-proxy\?url=.+$/.test(url.pathname + url.search),
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
    // 豆瓣外部图片缓存
    {
      matcher: ({ url }) =>
        /^(img\d+\.doubanio\.com|img3\.doubanio\.com|img\.doubanio\.cmliussss\.(net|com))$/.test(
          url.hostname,
        ),
      handler: new StaleWhileRevalidate({
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
        sameOrigin &&
        request.method === 'GET' &&
        url.pathname === '/api/proxy/segment' &&
        url.searchParams.get('icetv-live') !== '1',
      handler: new CacheFirst({
        cacheName: 'vod-segment-cache',
        plugins: [
          new CacheableResponsePlugin({ statuses: [200, 206] }),
          new ExpirationPlugin({
            maxEntries: 512,
            maxAgeSeconds: 7 * 24 * 60 * 60,
          }),
        ],
      }),
    },
  ],
});

serwist.addEventListeners();
