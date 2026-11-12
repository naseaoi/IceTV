import { orderDoubanRoutes } from '@/lib/douban-route-memory';
import type { DoubanImageProxyType } from '@/lib/douban-source';

export const DOUBAN_IMAGE_PROXY_TYPE_COOKIE = 'douban_image_proxy_type';
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export const PUBLIC_DOUBAN_IMAGE_PROXY_TYPES = new Set<DoubanImageProxyType>([
  'auto',
  'direct',
  'cmliussss-cdn-tencent',
  'cmliussss-cdn-ali',
]);

export function getUsableDoubanImageProxyType(
  proxyType: string,
  isAuthenticated: boolean,
): string {
  if (proxyType !== 'server') {
    return proxyType;
  }

  return isAuthenticated ? proxyType : 'auto';
}

export const AUTO_DOUBAN_IMAGE_ROUTES = [
  'cmliussss-cdn-tencent',
  'cmliussss-cdn-ali',
  'server',
] as const;

const CMLIUSSSS_IMAGE_URL_RE =
  /^https:\/\/img\.doubanio\.cmliussss\.(?:net|com)\//i;

export function isDoubanImageUrl(url: string): boolean {
  return url.includes('doubanio.com') || CMLIUSSSS_IMAGE_URL_RE.test(url);
}

// 首页服务端渲染已换成镜像地址；豆瓣各 img 子域内容相同，还原到 img1 供其他通道使用
function toOriginalDoubanImageUrl(url: string): string {
  return url.replace(CMLIUSSSS_IMAGE_URL_RE, 'https://img1.doubanio.com/');
}

export interface DoubanImageCandidate {
  url: string;
  route?: string;
}

export function getDoubanImageCandidates(
  url: string,
  proxyType: string,
  options: {
    proxyUrl?: string;
    isAuthenticated: boolean;
    preferredRoute?: string | null;
  },
): DoubanImageCandidate[] {
  const usableType = getUsableDoubanImageProxyType(
    proxyType,
    options.isAuthenticated,
  );
  if (usableType !== 'auto') {
    // 固定通道下镜像地址保持原样，避免把服务端渲染的地址再改写一次
    return [
      {
        url: CMLIUSSSS_IMAGE_URL_RE.test(url)
          ? url
          : processDoubanImageUrl(url, usableType, options.proxyUrl),
      },
    ];
  }

  const original = toOriginalDoubanImageUrl(url);
  const routes = AUTO_DOUBAN_IMAGE_ROUTES.filter(
    (route) => route !== 'server' || options.isAuthenticated,
  );
  const candidates = orderDoubanRoutes(
    routes,
    options.preferredRoute ?? null,
  ).map((route) => ({ url: processDoubanImageUrl(original, route), route }));
  // 非 img 子域的图片镜像不改写，去掉重复地址
  return candidates.filter(
    (candidate, index) =>
      candidates.findIndex((item) => item.url === candidate.url) === index,
  );
}

export function normalizePublicDoubanImageProxyType(
  value: string | undefined,
  fallback: DoubanImageProxyType,
): DoubanImageProxyType {
  return PUBLIC_DOUBAN_IMAGE_PROXY_TYPES.has(value as DoubanImageProxyType)
    ? (value as DoubanImageProxyType)
    : fallback;
}

export function processDoubanImageUrl(
  originalUrl: string,
  proxyType: string,
  proxyUrl = '',
): string {
  if (!originalUrl || !originalUrl.includes('doubanio.com')) {
    return originalUrl;
  }

  switch (proxyType) {
    case 'auto':
      return processDoubanImageUrl(originalUrl, AUTO_DOUBAN_IMAGE_ROUTES[0]);
    case 'direct':
      return originalUrl;
    case 'server':
      return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
    case 'cmliussss-cdn-tencent':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.net',
      );
    case 'cmliussss-cdn-ali':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.com',
      );
    case 'custom':
      return proxyUrl.trim()
        ? `${proxyUrl.trim()}${encodeURIComponent(originalUrl)}`
        : originalUrl;
    default:
      return originalUrl;
  }
}

export function writeDoubanImageProxyTypeCookie(proxyType: string) {
  if (typeof document === 'undefined') {
    return;
  }

  if (PUBLIC_DOUBAN_IMAGE_PROXY_TYPES.has(proxyType as DoubanImageProxyType)) {
    document.cookie = `${DOUBAN_IMAGE_PROXY_TYPE_COOKIE}=${encodeURIComponent(proxyType)};path=/;max-age=${COOKIE_MAX_AGE_SECONDS};samesite=lax`;
  } else {
    clearDoubanImageProxyTypeCookie();
  }
}

export function clearDoubanImageProxyTypeCookie() {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${DOUBAN_IMAGE_PROXY_TYPE_COOKIE}=;path=/;max-age=0;samesite=lax`;
}
