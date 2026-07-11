import he from 'he';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  getUsableDoubanImageProxyType,
  processDoubanImageUrl,
} from '@/lib/douban-image-url';
import {
  readDoubanImageProxyType,
  readDoubanImageProxyUrl,
} from '@/lib/douban-source';
import {
  type SourceCoverProxyMode,
  buildSourceCoverProxyUrl,
  normalizeSourceCoverProxyMode,
  shouldProxySourceCover,
} from '@/lib/source-cover-proxy';

export function processImageUrl(
  originalUrl: string,
  sourceCoverProxyMode?: SourceCoverProxyMode,
): string {
  if (!originalUrl) return originalUrl;

  if (
    originalUrl.includes('lain.bgm.tv') ||
    /^https:\/\/img\.doubanio\.cmliussss\.(net|com)\//i.test(originalUrl)
  ) {
    return originalUrl;
  }

  if (originalUrl.includes('doubanio.com')) {
    const proxyType = getUsableDoubanImageProxyType(
      readDoubanImageProxyType(),
      Boolean(getAuthInfoFromBrowserCookie()?.username),
    );
    return processDoubanImageUrl(
      originalUrl,
      proxyType,
      readDoubanImageProxyUrl(),
    );
  }

  try {
    const url = new URL(originalUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return originalUrl;
    }
    const mode = normalizeSourceCoverProxyMode(sourceCoverProxyMode);
    return shouldProxySourceCover(url.href, mode)
      ? buildSourceCoverProxyUrl(url.href)
      : url.href;
  } catch {
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
