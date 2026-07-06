import type { DoubanImageProxyType } from '@/lib/douban-source';

export const DOUBAN_IMAGE_PROXY_TYPE_COOKIE = 'douban_image_proxy_type';
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export const PUBLIC_DOUBAN_IMAGE_PROXY_TYPES = new Set<DoubanImageProxyType>([
  'direct',
  'img3',
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

  return isAuthenticated ? proxyType : 'direct';
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
    case 'direct':
      return originalUrl;
    case 'server':
      return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
    case 'img3':
      return originalUrl.replace(/img\d+\.doubanio\.com/g, 'img3.doubanio.com');
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
