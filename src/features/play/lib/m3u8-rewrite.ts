import type { NextRequest } from 'next/server';

import { appendProxySignature } from '@/lib/proxy-auth';
import { createSwrCache } from '@/lib/server-cache';
import { isSourceCorsCapable } from '@/lib/source-capability';
import { getBaseUrl, resolveUrl } from '@/lib/url-resolve';

export type M3U8RewriteEntry = {
  content: string;
  finalUrl: string;
  loadedAt: number;
};

const MAX_REWRITE_CACHE_CONTENT_BYTES = 2 * 1024 * 1024;

const m3u8RewriteCache = createSwrCache<string>({
  name: 'proxy-m3u8-rewrite',
  freshMs: 30_000,
  staleMs: 30_000,
  maxSize: 200,
  maxWeightBytes: 16 * 1024 * 1024,
});

export async function getRewrittenM3U8Content(
  entry: M3U8RewriteEntry,
  originalUrl: string,
  req: NextRequest,
  allowCORS: boolean,
  forceServer: boolean,
  source: string | null,
  isLive: boolean,
  cacheable: boolean,
): Promise<string> {
  const cacheKey =
    cacheable &&
    !isLive &&
    entry.content.length <= MAX_REWRITE_CACHE_CONTENT_BYTES
      ? getM3U8RewriteCacheKey(
          entry,
          originalUrl,
          req,
          allowCORS,
          forceServer,
          source,
          isLive,
        )
      : null;

  if (cacheKey) {
    const cached = m3u8RewriteCache.peek(cacheKey);
    if (cached) {
      return cached.value;
    }
  }

  const modifiedContent = await rewriteM3U8Content(
    entry.content,
    getBaseUrl(entry.finalUrl),
    req,
    allowCORS,
    forceServer,
    source,
    isLive,
  );

  if (cacheKey) {
    m3u8RewriteCache.set(cacheKey, modifiedContent);
  }

  return modifiedContent;
}

function getM3U8RewriteCacheKey(
  entry: M3U8RewriteEntry,
  originalUrl: string,
  req: NextRequest,
  allowCORS: boolean,
  forceServer: boolean,
  source: string | null,
  isLive: boolean,
): string {
  const requestUrl = new URL(req.url);
  const refererProtocol = getRequestProtocol(req);
  const host = req.headers.get('host') || '';
  return [
    originalUrl,
    entry.finalUrl,
    String(entry.loadedAt),
    refererProtocol,
    host,
    allowCORS ? 'cors' : 'proxy',
    forceServer ? 'force' : 'auto',
    source || '',
    isLive ? 'live' : 'vod',
    requestUrl.searchParams.get('icetv-switch') || '',
    requestUrl.searchParams.get('icetv-user-switch') || '',
  ].join('\0');
}

function getRequestProtocol(req: NextRequest): string {
  const referer = req.headers.get('referer');
  if (!referer) return 'http';

  try {
    const refererUrl = new URL(referer);
    return refererUrl.protocol.replace(':', '');
  } catch {
    return 'http';
  }
}

async function rewriteM3U8Content(
  content: string,
  baseUrl: string,
  req: NextRequest,
  allowCORS: boolean,
  forceServer: boolean,
  source: string | null,
  isLive: boolean,
): Promise<string> {
  const protocol = getRequestProtocol(req);
  const host = req.headers.get('host');
  const proxyBase = `${protocol}://${host}/api/proxy`;
  const requestSearchParams = new URL(req.url).searchParams;
  const switchAction = requestSearchParams.get('icetv-switch');
  const userSwitch = requestSearchParams.get('icetv-user-switch');
  const corsCapable =
    !isLive && source ? isSourceCorsCapable(source) === true : false;
  const effectiveAllowCors = !forceServer && (allowCORS || corsCapable);

  const lines = content.split('\n');
  const rewrittenLines: Array<string | Promise<string>> = [];
  const proxyUrlCache = new Map<string, Promise<string>>();

  const buildProxyPath = async (
    path: 'segment' | 'm3u8' | 'key',
    targetUrl: string,
    extra: Record<string, string> = {},
  ) => {
    const extraKey = new URLSearchParams(extra).toString();
    const cacheKey = `${path}\0${targetUrl}\0${extraKey}`;
    const cached = proxyUrlCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const task = (async () => {
      const params = new URLSearchParams({
        url: targetUrl,
        ...extra,
      });
      if (source) {
        params.set('icetv-source', source);
      }
      if (isLive) {
        params.set('icetv-live', '1');
      }
      if (switchAction) {
        params.set('icetv-switch', switchAction);
      }
      if (userSwitch) {
        params.set('icetv-user-switch', userSwitch);
      }
      await appendProxySignature(params, path, targetUrl);
      return `${proxyBase}/${path}?${params.toString()}`;
    })();

    proxyUrlCache.set(cacheKey, task);
    return task;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line && !line.startsWith('#')) {
      const resolvedUrl = resolveUrl(baseUrl, line);
      rewrittenLines.push(
        effectiveAllowCors
          ? resolvedUrl
          : buildProxyPath('segment', resolvedUrl),
      );
      continue;
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      rewrittenLines.push(
        rewriteMapUri(line, baseUrl, effectiveAllowCors, buildProxyPath),
      );
      continue;
    }

    if (line.startsWith('#EXT-X-KEY:')) {
      rewrittenLines.push(
        rewriteKeyUri(line, baseUrl, effectiveAllowCors, buildProxyPath),
      );
      continue;
    }

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      rewrittenLines.push(line);
      if (i + 1 < lines.length) {
        i++;
        const nextLine = lines[i].trim();
        if (nextLine && !nextLine.startsWith('#')) {
          const resolvedUrl = resolveUrl(baseUrl, nextLine);
          rewrittenLines.push(
            buildProxyPath(
              'm3u8',
              resolvedUrl,
              forceServer
                ? { forceServer: 'true' }
                : allowCORS
                  ? { allowCORS: 'true' }
                  : {},
            ),
          );
        } else {
          rewrittenLines.push(nextLine);
        }
      }
      continue;
    }

    rewrittenLines.push(line);
  }

  const resolvedLines = await Promise.all(rewrittenLines);
  return resolvedLines.join('\n');
}

type ProxyPathBuilder = (
  path: 'segment' | 'm3u8' | 'key',
  targetUrl: string,
  extra?: Record<string, string>,
) => Promise<string>;

function rewriteMapUri(
  line: string,
  baseUrl: string,
  allowDirect: boolean,
  buildProxyPath: ProxyPathBuilder,
): string | Promise<string> {
  const uriMatch = line.match(/URI="([^"]+)"/);
  if (uriMatch) {
    const originalUri = uriMatch[1];
    const resolvedUrl = resolveUrl(baseUrl, originalUri);
    if (allowDirect) {
      return line.replace(uriMatch[0], `URI="${resolvedUrl}"`);
    }
    return buildProxyPath('segment', resolvedUrl).then((proxyUrl) =>
      line.replace(uriMatch[0], `URI="${proxyUrl}"`),
    );
  }
  return line;
}

function rewriteKeyUri(
  line: string,
  baseUrl: string,
  allowDirect: boolean,
  buildProxyPath: ProxyPathBuilder,
): string | Promise<string> {
  const uriMatch = line.match(/URI="([^"]+)"/);
  if (uriMatch) {
    const originalUri = uriMatch[1];
    const resolvedUrl = resolveUrl(baseUrl, originalUri);
    if (allowDirect) {
      return line.replace(uriMatch[0], `URI="${resolvedUrl}"`);
    }
    return buildProxyPath('key', resolvedUrl).then((proxyUrl) =>
      line.replace(uriMatch[0], `URI="${proxyUrl}"`),
    );
  }
  return line;
}
