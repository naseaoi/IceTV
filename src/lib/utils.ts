import he from 'he';

import {
  readDoubanImageProxyType,
  readDoubanImageProxyUrl,
} from '@/lib/douban-source';

export function processImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  if (!originalUrl.includes('doubanio.com')) {
    return originalUrl;
  }

  const proxyType = readDoubanImageProxyType();
  const proxyUrl = readDoubanImageProxyUrl();
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

function decodeHtmlText(text: string): string {
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

export function parseStorageKey(
  key: string,
): { source: string; id: string } | null {
  const idx = key.indexOf('+');
  if (idx <= 0 || idx === key.length - 1) return null;
  return { source: key.substring(0, idx), id: key.substring(idx + 1) };
}
