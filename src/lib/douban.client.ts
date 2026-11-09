import { getAuthInfoFromBrowserCookie } from './auth.client';
import {
  DoubanCategoryApiResponse,
  DoubanListApiResponse,
  DoubanRecommendApiResponse,
  normalizeDoubanCategoryItems,
  normalizeDoubanListSubjects,
  normalizeDoubanRecommendItems,
} from './douban-normalize';
import {
  orderDoubanRoutes,
  readDoubanFallbackRoute,
  recordDoubanRouteResult,
} from './douban-route-memory';
import { readDoubanProxyType, readDoubanProxyUrl } from './douban-source';
import {
  buildDoubanRecentHotUrl,
  buildDoubanRecommendUrl,
  buildDoubanSearchSubjectsUrl,
  DoubanUpstreamHost,
} from './douban-upstream-url';
import { createTimedAbortController } from './downstream-sources/shared';
import { DoubanResult } from './types';

// ================================================================
// 请求去重 + SWR 缓存：避免切换筛选条件后重复请求相同数据
// - fresh 期内命中：直接复用 Promise
// - stale 期内命中：立即返回旧结果，同时后台刷新
// - 超过 stale：视为未命中，重新回源
// 淘汰策略：LRU（按最近命中时间）
// ================================================================

interface CachedRequest {
  // 最近一次成功结果快照；回源未完成前为 undefined
  value?: DoubanResult;
  // 正在进行中的请求（用于并发合并）
  pending?: Promise<DoubanResult>;
  // 新鲜截止
  freshUntil: number;
  // 软过期截止（超过后彻底丢弃）
  staleUntil: number;
  // 最近访问时间（用于 LRU 淘汰）
  lastAccess: number;
}

const requestDedupCache = new Map<string, CachedRequest>();
const DEDUP_FRESH_MS = 2 * 60 * 1000; // 2 分钟新鲜期
const DEDUP_STALE_MS = 5 * 60 * 1000; // 再 5 分钟软过期窗口
const DEDUP_MAX_SIZE = 200;

// 超出上限时按 lastAccess 淘汰最老项
function evictIfNeeded() {
  if (requestDedupCache.size <= DEDUP_MAX_SIZE) return;
  const toRemove = requestDedupCache.size - DEDUP_MAX_SIZE;
  const entries = Array.from(requestDedupCache.entries()).sort(
    (a, b) => a[1].lastAccess - b[1].lastAccess,
  );
  for (let i = 0; i < toRemove; i++) {
    requestDedupCache.delete(entries[i][0]);
  }
}

// 触发一次真正的回源，并在成功后写入缓存
function triggerLoad(
  key: string,
  fn: () => Promise<DoubanResult>,
): Promise<DoubanResult> {
  const pending = fn()
    .then((result) => {
      const now = Date.now();
      const entry = requestDedupCache.get(key);
      if (entry) {
        entry.value = result;
        entry.freshUntil = now + DEDUP_FRESH_MS;
        entry.staleUntil = now + DEDUP_FRESH_MS + DEDUP_STALE_MS;
        entry.lastAccess = now;
        entry.pending = undefined;
      }
      return result;
    })
    .catch((err) => {
      // 失败：若已有旧值保留；否则彻底删除以便下次重试
      const entry = requestDedupCache.get(key);
      if (entry) {
        entry.pending = undefined;
        if (!entry.value) requestDedupCache.delete(key);
      }
      throw err;
    });

  const now = Date.now();
  const existing = requestDedupCache.get(key);
  if (existing) {
    existing.pending = pending;
    existing.lastAccess = now;
  } else {
    requestDedupCache.set(key, {
      pending,
      freshUntil: now,
      staleUntil: now + DEDUP_FRESH_MS + DEDUP_STALE_MS,
      lastAccess: now,
    });
  }
  evictIfNeeded();
  return pending;
}

function withRequestDedup(
  key: string,
  fn: () => Promise<DoubanResult>,
): Promise<DoubanResult> {
  const now = Date.now();
  const cached = requestDedupCache.get(key);

  if (cached) {
    cached.lastAccess = now;
    // 正在进行的请求直接复用
    if (cached.pending) return cached.pending;
    // fresh 命中：直接返回缓存值
    if (cached.value && now < cached.freshUntil) {
      return Promise.resolve(cached.value);
    }
    // stale 命中：返回旧值，同时后台刷新
    if (cached.value && now < cached.staleUntil) {
      triggerLoad(key, fn).catch(() => {
        /* 后台刷新失败保留旧值 */
      });
      return Promise.resolve(cached.value);
    }
    // 彻底过期
    requestDedupCache.delete(key);
  }

  return triggerLoad(key, fn);
}

interface DoubanCategoriesParams {
  kind: 'tv' | 'movie';
  category: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

/**
 * 带超时的 fetch 请求
 */
async function fetchWithTimeout(
  url: string,
  proxyUrl: string,
): Promise<Response> {
  const timed = createTimedAbortController(undefined, 10000);

  // 检查是否使用代理
  const finalUrl =
    proxyUrl === 'https://cors-anywhere.com/'
      ? `${proxyUrl}${url}`
      : proxyUrl
        ? `${proxyUrl}${encodeURIComponent(url)}`
        : url;

  const fetchOptions: RequestInit = {
    signal: timed.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: 'https://movie.douban.com/',
      Accept: 'application/json, text/plain, */*',
    },
  };

  try {
    return await fetch(finalUrl, fetchOptions);
  } finally {
    timed.cleanup();
  }
}

// 镜像站自带跨域支持，不再叠加 CORS 代理
type DoubanProxyLoader = (
  proxyUrl: string,
  host?: DoubanUpstreamHost,
) => Promise<DoubanResult>;

function isDoubanResult(value: unknown): value is DoubanResult {
  const result = value as DoubanResult | null;
  return result?.code === 200 && Array.isArray(result.list);
}

// 失败必须 reject：成功结果会进请求缓存，界面也会把空列表当成「没有更多」
async function fetchDoubanFromServer(
  serverPath: string,
): Promise<DoubanResult> {
  const response = await fetch(serverPath);
  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!isDoubanResult(data)) {
    throw new Error('豆瓣数据格式异常');
  }
  return data;
}

// 第三方公益代理优先，本站服务端兜底（仅登录用户可用）；浏览器直连受跨域限制，不参与自动
const AUTO_DOUBAN_DATA_ROUTES = [
  'cors-proxy-zwei',
  'cmliussss-cdn-tencent',
  'server',
] as const;

function isAuthenticated(): boolean {
  return Boolean(getAuthInfoFromBrowserCookie()?.username);
}

function fetchDoubanRoute(
  route: string,
  serverPath: string,
  loader: DoubanProxyLoader,
): Promise<DoubanResult> {
  switch (route) {
    case 'cors-proxy-zwei':
      return loader('https://ciao-cors.is-an.org/');
    case 'cmliussss-cdn-tencent':
      return loader('', 'cmliussss-tencent');
    case 'cmliussss-cdn-ali':
      return loader('', 'cmliussss-ali');
    case 'cors-anywhere':
      return loader('https://cors-anywhere.com/');
    case 'server':
      return fetchDoubanFromServer(serverPath);
    case 'direct':
    default:
      return loader('');
  }
}

async function fetchDoubanAuto(
  serverPath: string,
  loader: DoubanProxyLoader,
): Promise<DoubanResult> {
  const routes = orderDoubanRoutes(
    AUTO_DOUBAN_DATA_ROUTES.filter(
      (route) => route !== 'server' || isAuthenticated(),
    ),
    readDoubanFallbackRoute('data'),
  );
  let lastError: unknown;
  for (let index = 0; index < routes.length; index += 1) {
    try {
      const result = await fetchDoubanRoute(routes[index], serverPath, loader);
      recordDoubanRouteResult(
        'data',
        routes,
        AUTO_DOUBAN_DATA_ROUTES[0],
        index,
        true,
      );
      return result;
    } catch (error) {
      recordDoubanRouteResult(
        'data',
        routes,
        AUTO_DOUBAN_DATA_ROUTES[0],
        index,
        false,
      );
      lastError = error;
    }
  }
  throw lastError;
}

function fetchWithDoubanProxy(
  serverPath: string,
  loader: DoubanProxyLoader,
): Promise<DoubanResult> {
  const proxyType = readDoubanProxyType();
  if (proxyType === 'custom') {
    const proxyUrl = readDoubanProxyUrl().trim();
    if (!proxyUrl) {
      return Promise.reject(new Error('豆瓣自定义代理地址不能为空'));
    }
    return loader(proxyUrl);
  }
  // 游客不能用本站服务端，改走自动
  if (proxyType === 'auto' || (proxyType === 'server' && !isAuthenticated())) {
    return fetchDoubanAuto(serverPath, loader);
  }
  return fetchDoubanRoute(proxyType, serverPath, loader);
}

function createQueryString(
  entries: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

async function fetchDoubanCategories(
  params: DoubanCategoriesParams,
  proxyUrl: string,
  host: DoubanUpstreamHost = 'douban',
): Promise<DoubanResult> {
  const { kind, category, type, pageLimit = 20, pageStart = 0 } = params;

  // 验证参数
  if (!['tv', 'movie'].includes(kind)) {
    throw new Error('kind 参数必须是 tv 或 movie');
  }

  if (!category || !type) {
    throw new Error('category 和 type 参数不能为空');
  }

  if (pageLimit < 1 || pageLimit > 100) {
    throw new Error('pageLimit 必须在 1-100 之间');
  }

  if (pageStart < 0) {
    throw new Error('pageStart 不能小于 0');
  }

  const target = buildDoubanRecentHotUrl(
    { kind, category, type, start: pageStart, limit: pageLimit },
    host,
  );

  try {
    const response = await fetchWithTimeout(
      target,
      host === 'douban' ? proxyUrl : '',
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const doubanData: DoubanCategoryApiResponse = await response.json();

    const list = normalizeDoubanCategoryItems(doubanData.items);

    return {
      code: 200,
      message: '获取成功',
      list: list,
    };
  } catch (error) {
    throw new Error(`获取豆瓣分类数据失败: ${(error as Error).message}`);
  }
}

/**
 * 统一的豆瓣分类数据获取函数，根据代理设置选择使用服务端 API 或客户端代理获取
 */
export function getDoubanCategories(
  params: DoubanCategoriesParams,
): Promise<DoubanResult> {
  const { kind, category, type, pageLimit = 20, pageStart = 0 } = params;
  const key = `cat:${kind}:${category}:${type}:${pageLimit}:${pageStart}`;
  return withRequestDedup(key, async () => {
    const query = createQueryString({
      kind,
      category,
      type,
      limit: pageLimit,
      start: pageStart,
    });
    return fetchWithDoubanProxy(
      `/api/douban/categories?${query}`,
      (proxyUrl, host) => fetchDoubanCategories(params, proxyUrl, host),
    );
  });
}

interface DoubanListParams {
  tag: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

export function getDoubanList(params: DoubanListParams): Promise<DoubanResult> {
  const { tag, type, pageLimit = 20, pageStart = 0 } = params;
  const key = `list:${tag}:${type}:${pageLimit}:${pageStart}`;
  return withRequestDedup(key, async () => {
    const query = createQueryString({
      tag,
      type,
      pageSize: pageLimit,
      pageStart,
    });
    return fetchWithDoubanProxy(`/api/douban?${query}`, (proxyUrl, host) =>
      fetchDoubanList(params, proxyUrl, host),
    );
  });
}

async function fetchDoubanList(
  params: DoubanListParams,
  proxyUrl: string,
  host: DoubanUpstreamHost = 'douban',
): Promise<DoubanResult> {
  const { tag, type, pageLimit = 20, pageStart = 0 } = params;

  // 验证参数
  if (!tag || !type) {
    throw new Error('tag 和 type 参数不能为空');
  }

  if (!['tv', 'movie'].includes(type)) {
    throw new Error('type 参数必须是 tv 或 movie');
  }

  if (pageLimit < 1 || pageLimit > 100) {
    throw new Error('pageLimit 必须在 1-100 之间');
  }

  if (pageStart < 0) {
    throw new Error('pageStart 不能小于 0');
  }

  const target = buildDoubanSearchSubjectsUrl(
    { type: type as 'tv' | 'movie', tag, start: pageStart, limit: pageLimit },
    host,
  );

  try {
    const response = await fetchWithTimeout(
      target,
      host === 'douban' ? proxyUrl : '',
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const doubanData: DoubanListApiResponse = await response.json();

    const list = normalizeDoubanListSubjects(doubanData.subjects);

    return {
      code: 200,
      message: '获取成功',
      list: list,
    };
  } catch (error) {
    throw new Error(`获取豆瓣列表数据失败: ${(error as Error).message}`);
  }
}

interface DoubanRecommendsParams {
  kind: 'tv' | 'movie';
  pageLimit?: number;
  pageStart?: number;
  category?: string;
  format?: string;
  label?: string;
  region?: string;
  year?: string;
  platform?: string;
  sort?: string;
}

export function getDoubanRecommends(
  params: DoubanRecommendsParams,
): Promise<DoubanResult> {
  const {
    kind,
    pageLimit = 20,
    pageStart = 0,
    category,
    format,
    label,
    region,
    year,
    platform,
    sort,
  } = params;
  const key = `rec:${kind}:${pageStart}:${pageLimit}:${category}:${format}:${label}:${region}:${year}:${platform}:${sort}`;
  return withRequestDedup(key, async () => {
    const query = createQueryString({
      kind,
      limit: pageLimit,
      start: pageStart,
      category,
      format,
      region,
      year,
      platform,
      sort,
      label,
    });
    return fetchWithDoubanProxy(
      `/api/douban/recommends?${query}`,
      (proxyUrl, host) => fetchDoubanRecommends(params, proxyUrl, host),
    );
  });
}

async function fetchDoubanRecommends(
  params: DoubanRecommendsParams,
  proxyUrl: string,
  host: DoubanUpstreamHost = 'douban',
): Promise<DoubanResult> {
  const target = buildDoubanRecommendUrl(
    {
      ...params,
      start: params.pageStart ?? 0,
      limit: params.pageLimit ?? 20,
    },
    host,
  );
  try {
    const response = await fetchWithTimeout(
      target,
      host === 'douban' ? proxyUrl : '',
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const doubanData: DoubanRecommendApiResponse = await response.json();
    const list = normalizeDoubanRecommendItems(doubanData.items);

    return {
      code: 200,
      message: '获取成功',
      list: list,
    };
  } catch (error) {
    throw new Error(`获取豆瓣推荐数据失败: ${(error as Error).message}`);
  }
}
