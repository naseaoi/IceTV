import he from 'he';

import { toBangumiCoverProxyUrl } from '@/features/bangumi/lib/bangumi-cover-url';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  getDoubanImageCandidates,
  isDoubanImageUrl,
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

export interface ImageCandidate {
  url: string;
  // 豆瓣「自动」通道名，用于记住回退成功的通道
  doubanRoute?: string;
  // 源站封面的服务端代理地址，失败后按原 host 冷却
  sourceProxy?: boolean;
}

// 按尝试顺序给出封面地址：首项即默认地址，后续项为加载失败后的回退
export function getImageCandidates(
  originalUrl: string,
  sourceCoverProxyMode?: SourceCoverProxyMode,
  preferredDoubanRoute: string | null = null,
): ImageCandidate[] {
  if (!originalUrl) return [];

  const bangumiCoverProxyUrl = toBangumiCoverProxyUrl(originalUrl);
  if (bangumiCoverProxyUrl) {
    return [{ url: bangumiCoverProxyUrl }, { url: originalUrl }];
  }

  if (isDoubanImageUrl(originalUrl)) {
    return getDoubanImageCandidates(originalUrl, readDoubanImageProxyType(), {
      proxyUrl: readDoubanImageProxyUrl(),
      isAuthenticated: Boolean(getAuthInfoFromBrowserCookie()?.username),
      preferredRoute: preferredDoubanRoute,
    }).map(({ url, route }) => ({ url, doubanRoute: route }));
  }

  try {
    const url = new URL(originalUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return [{ url: originalUrl }];
    }
    const mode = normalizeSourceCoverProxyMode(sourceCoverProxyMode);
    if (!shouldProxySourceCover(url.href, mode)) return [{ url: url.href }];
    const proxyUrl = buildSourceCoverProxyUrl(url.href);
    return mode === 'auto'
      ? [{ url: proxyUrl, sourceProxy: true }, { url: url.href }]
      : [{ url: proxyUrl }];
  } catch {
    return [{ url: originalUrl }];
  }
}

export function processImageUrl(
  originalUrl: string,
  sourceCoverProxyMode?: SourceCoverProxyMode,
): string {
  return (
    getImageCandidates(originalUrl, sourceCoverProxyMode)[0]?.url ?? originalUrl
  );
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
