import { DoubanItem, DoubanResult } from './types';

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

interface DoubanCategoryApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

interface DoubanListApiResponse {
  total: number;
  subjects: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    cover: string;
    rate: string;
  }>;
}

interface DoubanRecommendApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    year: string;
    type: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

/**
 * 带超时的 fetch 请求
 */
async function fetchWithTimeout(
  url: string,
  proxyUrl: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

  // 检查是否使用代理
  const finalUrl =
    proxyUrl === 'https://cors-anywhere.com/'
      ? `${proxyUrl}${url}`
      : proxyUrl
        ? `${proxyUrl}${encodeURIComponent(url)}`
        : url;

  const fetchOptions: RequestInit = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: 'https://movie.douban.com/',
      Accept: 'application/json, text/plain, */*',
    },
  };

  try {
    const response = await fetch(finalUrl, fetchOptions);
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

type DoubanProxyType =
  | 'direct'
  | 'cors-proxy-zwei'
  | 'cmliussss-cdn-tencent'
  | 'cmliussss-cdn-ali'
  | 'cors-anywhere'
  | 'custom';

function getDoubanProxyConfig(): {
  proxyType: DoubanProxyType;
  proxyUrl: string;
} {
  if (typeof window === 'undefined') {
    return { proxyType: 'direct', proxyUrl: '' };
  }
  const doubanProxyType =
    localStorage.getItem('doubanDataSource') ||
    window.RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE ||
    'direct';
  const doubanProxy =
    localStorage.getItem('doubanProxyUrl') ||
    window.RUNTIME_CONFIG?.DOUBAN_PROXY ||
    '';
  return {
    proxyType: doubanProxyType as DoubanProxyType,
    proxyUrl: doubanProxy,
  };
}

async function fetchDoubanCategories(
  params: DoubanCategoriesParams,
  proxyUrl: string,
  useTencentCDN = false,
  useAliCDN = false,
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

  const target = useTencentCDN
    ? `https://m.douban.cmliussss.net/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${category}&type=${type}`
    : useAliCDN
      ? `https://m.douban.cmliussss.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${category}&type=${type}`
      : `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${category}&type=${type}`;

  try {
    const response = await fetchWithTimeout(
      target,
      useTencentCDN || useAliCDN ? '' : proxyUrl,
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const doubanData: DoubanCategoryApiResponse = await response.json();

    // 转换数据格式
    const list: DoubanItem[] = doubanData.items.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.pic?.normal || item.pic?.large || '',
      rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));

    return {
      code: 200,
      message: '获取成功',
      list: list,
    };
  } catch (error) {
    // 触发全局错误提示
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('globalError', {
          detail: { message: '获取豆瓣分类数据失败' },
        }),
      );
    }
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
    const { proxyType, proxyUrl } = getDoubanProxyConfig();
    switch (proxyType) {
      case 'cors-proxy-zwei':
        return fetchDoubanCategories(params, 'https://ciao-cors.is-an.org/');
      case 'cmliussss-cdn-tencent':
        return fetchDoubanCategories(params, '', true, false);
      case 'cmliussss-cdn-ali':
        return fetchDoubanCategories(params, '', false, true);
      case 'cors-anywhere':
        return fetchDoubanCategories(params, 'https://cors-anywhere.com/');
      case 'custom':
        return fetchDoubanCategories(params, proxyUrl);
      case 'direct':
      default: {
        const response = await fetch(
          `/api/douban/categories?kind=${kind}&category=${category}&type=${type}&limit=${pageLimit}&start=${pageStart}`,
        );
        return response.json();
      }
    }
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
    const { proxyType, proxyUrl } = getDoubanProxyConfig();
    switch (proxyType) {
      case 'cors-proxy-zwei':
        return fetchDoubanList(params, 'https://ciao-cors.is-an.org/');
      case 'cmliussss-cdn-tencent':
        return fetchDoubanList(params, '', true, false);
      case 'cmliussss-cdn-ali':
        return fetchDoubanList(params, '', false, true);
      case 'cors-anywhere':
        return fetchDoubanList(params, 'https://cors-anywhere.com/');
      case 'custom':
        return fetchDoubanList(params, proxyUrl);
      case 'direct':
      default: {
        const response = await fetch(
          `/api/douban?tag=${tag}&type=${type}&pageSize=${pageLimit}&pageStart=${pageStart}`,
        );
        return response.json();
      }
    }
  });
}

async function fetchDoubanList(
  params: DoubanListParams,
  proxyUrl: string,
  useTencentCDN = false,
  useAliCDN = false,
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

  const target = useTencentCDN
    ? `https://movie.douban.cmliussss.net/j/search_subjects?type=${type}&tag=${tag}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`
    : useAliCDN
      ? `https://movie.douban.cmliussss.com/j/search_subjects?type=${type}&tag=${tag}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`
      : `https://movie.douban.com/j/search_subjects?type=${type}&tag=${tag}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`;

  try {
    const response = await fetchWithTimeout(
      target,
      useTencentCDN || useAliCDN ? '' : proxyUrl,
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const doubanData: DoubanListApiResponse = await response.json();

    // 转换数据格式
    const list: DoubanItem[] = doubanData.subjects.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.cover,
      rate: item.rate,
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));

    return {
      code: 200,
      message: '获取成功',
      list: list,
    };
  } catch (error) {
    // 触发全局错误提示
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('globalError', {
          detail: { message: '获取豆瓣列表数据失败' },
        }),
      );
    }
    throw new Error(`获取豆瓣分类数据失败: ${(error as Error).message}`);
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
    const { proxyType, proxyUrl } = getDoubanProxyConfig();
    switch (proxyType) {
      case 'cors-proxy-zwei':
        return fetchDoubanRecommends(params, 'https://ciao-cors.is-an.org/');
      case 'cmliussss-cdn-tencent':
        return fetchDoubanRecommends(params, '', true, false);
      case 'cmliussss-cdn-ali':
        return fetchDoubanRecommends(params, '', false, true);
      case 'cors-anywhere':
        return fetchDoubanRecommends(params, 'https://cors-anywhere.com/');
      case 'custom':
        return fetchDoubanRecommends(params, proxyUrl);
      case 'direct':
      default: {
        const response = await fetch(
          `/api/douban/recommends?kind=${kind}&limit=${pageLimit}&start=${pageStart}&category=${category}&format=${format}&region=${region}&year=${year}&platform=${platform}&sort=${sort}&label=${label}`,
        );
        return response.json();
      }
    }
  });
}

async function fetchDoubanRecommends(
  params: DoubanRecommendsParams,
  proxyUrl: string,
  useTencentCDN = false,
  useAliCDN = false,
): Promise<DoubanResult> {
  const { kind, pageLimit = 20, pageStart = 0 } = params;
  let { category, format, region, year, platform, sort, label } = params;
  if (category === 'all') {
    category = '';
  }
  if (format === 'all') {
    format = '';
  }
  if (label === 'all') {
    label = '';
  }
  if (region === 'all') {
    region = '';
  }
  if (year === 'all') {
    year = '';
  }
  if (platform === 'all') {
    platform = '';
  }
  if (sort === 'T') {
    sort = '';
  }

  const selectedCategories = { 类型: category } as any;
  if (format) {
    selectedCategories['形式'] = format;
  }
  if (region) {
    selectedCategories['地区'] = region;
  }

  const tags = [] as Array<string>;
  if (category) {
    tags.push(category);
  }
  if (!category && format) {
    tags.push(format);
  }
  if (label) {
    tags.push(label);
  }
  if (region) {
    tags.push(region);
  }
  if (year) {
    tags.push(year);
  }
  if (platform) {
    tags.push(platform);
  }

  const baseUrl = useTencentCDN
    ? `https://m.douban.cmliussss.net/rexxar/api/v2/${kind}/recommend`
    : useAliCDN
      ? `https://m.douban.cmliussss.com/rexxar/api/v2/${kind}/recommend`
      : `https://m.douban.com/rexxar/api/v2/${kind}/recommend`;
  const reqParams = new URLSearchParams();
  reqParams.append('refresh', '0');
  reqParams.append('start', pageStart.toString());
  reqParams.append('count', pageLimit.toString());
  reqParams.append('selected_categories', JSON.stringify(selectedCategories));
  reqParams.append('uncollect', 'false');
  reqParams.append('score_range', '0,10');
  reqParams.append('tags', tags.join(','));
  if (sort) {
    reqParams.append('sort', sort);
  }
  const target = `${baseUrl}?${reqParams.toString()}`;
  try {
    const response = await fetchWithTimeout(
      target,
      useTencentCDN || useAliCDN ? '' : proxyUrl,
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const doubanData: DoubanRecommendApiResponse = await response.json();
    const list: DoubanItem[] = doubanData.items
      .filter((item) => item.type == 'movie' || item.type == 'tv')
      .map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.pic?.normal || item.pic?.large || '',
        rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
        year: item.year,
      }));

    return {
      code: 200,
      message: '获取成功',
      list: list,
    };
  } catch (error) {
    throw new Error(`获取豆瓣推荐数据失败: ${(error as Error).message}`);
  }
}
