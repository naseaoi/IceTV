import he from 'he';

export type DoubanImageProxyType =
  | 'direct'
  | 'server'
  | 'img3'
  | 'cmliussss-cdn-tencent'
  | 'cmliussss-cdn-ali'
  | 'custom';

/**
 * 获取豆瓣图片代理配置。
 * 优先级：用户手动设置(localStorage) > 管理后台(RUNTIME_CONFIG) > 默认 CDN
 */
export function getDoubanImageProxyConfig(): {
  proxyType: DoubanImageProxyType;
  proxyUrl: string;
} {
  if (typeof window === 'undefined') {
    // SSR 端返回默认 CDN 配置
    return { proxyType: 'cmliussss-cdn-tencent', proxyUrl: '' };
  }
  const doubanImageProxyType =
    localStorage.getItem('doubanImageProxyType') ||
    window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE ||
    'cmliussss-cdn-tencent';
  const doubanImageProxy =
    localStorage.getItem('doubanImageProxyUrl') ||
    window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY ||
    '';
  return {
    proxyType: doubanImageProxyType as DoubanImageProxyType,
    proxyUrl: doubanImageProxy,
  };
}

/**
 * 处理豆瓣图片 URL，根据代理配置替换域名或走代理。
 * - direct: 原样返回，由 CoverImage 设置 unoptimized + referrerPolicy='no-referrer' 绕过防盗链
 * - server: 走本地 /api/image-proxy 服务端代理
 * - img3: 替换域名为 img3.doubanio.com
 * - cmliussss-cdn-*: 替换为对应 CDN 域名
 * - custom: 拼接自定义代理前缀
 */
export function processImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  // 仅处理豆瓣图片
  if (!originalUrl.includes('doubanio.com')) {
    return originalUrl;
  }

  const { proxyType, proxyUrl } = getDoubanImageProxyConfig();
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
      return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
    default:
      return originalUrl;
  }
}

/**
 * 解码 HTML 实体。部分源站会把实体重复编码两次，这里做两轮解码兜底。
 */
export function decodeHtmlText(text: string): string {
  if (!text) return '';

  let decoded = text;
  for (let index = 0; index < 2; index += 1) {
    const next = he.decode(decoded);
    if (next === decoded) {
      break;
    }
    decoded = next;
  }

  return decoded.replace(/&nbsp;/gi, ' ').replace(/\u00a0/g, ' ');
}

/**
 * 适合按钮标题、徽章标题这类单行文案，统一清掉实体和多余空白。
 */
export function normalizeInlineText(text: string): string {
  return decodeHtmlText(text).replace(/\s+/g, ' ').trim();
}

export function cleanHtmlTags(text: string): string {
  if (!text) return '';

  const cleanedText = text
    .replace(/<[^>]+>/g, '\n')
    .replace(/\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/^\n+|\n+$/g, '')
    .trim();

  return decodeHtmlText(cleanedText);
}

/**
 * 解析存储 key（格式：`{source}+{id}`）
 * 返回 null 表示格式无效
 */
export function parseStorageKey(
  key: string,
): { source: string; id: string } | null {
  const idx = key.indexOf('+');
  if (idx <= 0 || idx === key.length - 1) return null;
  return { source: key.substring(0, idx), id: key.substring(idx + 1) };
}
