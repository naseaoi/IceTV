import { NextRequest, NextResponse } from 'next/server';

import {
  shouldRunAdDetection,
  stripAdSegmentsByPhysicalSignal,
} from '@/lib/ad-segment-detector';
import { getBaseUrl, resolveUrl } from '@/lib/live';
import {
  readTextLimited,
  ResponseSizeLimitError,
} from '@/lib/proxy-response-limits';
import { appendProxySignature, authorizeProxyRequest } from '@/lib/proxy-auth';
import { createSwrCache } from '@/lib/server-cache';
import { isSourceCorsCapable } from '@/lib/source-capability';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

import { getProxySourceKey, resolveProxyUserAgent } from '../utils';

export const runtime = 'nodejs';

// ================================================================
// VOD M3U8 清单缓存（SWR 软过期 + 请求合并）
// - 只缓存 VOD / Master playlist，直播清单不缓存
// - fresh 60s：期内直接返回
// - stale 60s：返回旧内容同时后台刷新，并发同 URL 自动合并
// ================================================================

type M3U8CacheEntry = {
  content: string;
  contentType: string;
  finalUrl: string;
};

type M3U8LoadResult = M3U8CacheEntry & {
  status: number;
  statusText: string;
};

const m3u8Cache = createSwrCache<M3U8CacheEntry>({
  name: 'proxy-m3u8',
  freshMs: 60_000,
  staleMs: 60_000,
  maxSize: 500,
});

// 识别带 token/签名的短时效 URL：命中后跳过本地 SWR 缓存，
// 避免缓存把过期 token 沉淀下来导致 hls.js 拉 ts 直接 403。
// 只匹配 query 中的明显签名字段；保守一点漏判好过误判。
const SIGNED_URL_PARAM_RE =
  /[?&](sign|signature|auth_key|auth|token|expires?|expire|hmac|x-amz-signature|security_token|oss_expires|wssecret|wstime|ccode|ksign)=/i;
const MAX_M3U8_BYTES = 2 * 1024 * 1024;

function isSignedM3U8Url(rawUrl: string): boolean {
  if (!rawUrl) return false;
  if (!rawUrl.includes('?')) return false;
  return SIGNED_URL_PARAM_RE.test(rawUrl);
}

// 软过期后台刷新：同 URL 并发刷新请求合并，避免雷群
const m3u8RefreshInflight = new Map<string, Promise<void>>();
const m3u8LoadInflight = new Map<string, Promise<M3U8LoadResult>>();

function refreshM3U8Cache(
  url: string,
  ua: string,
  source: string | null,
): Promise<void> {
  const existing = m3u8RefreshInflight.get(url);
  if (existing) return existing;

  const task = (async () => {
    try {
      const response = await fetchWithUrlGuard(url, {
        cache: 'no-cache',
        redirect: 'follow',
        credentials: 'same-origin',
        headers: { 'User-Agent': ua },
      });
      if (!response.ok) return;
      const contentType = response.headers.get('Content-Type') || '';
      if (
        !contentType.toLowerCase().includes('mpegurl') &&
        !contentType.toLowerCase().includes('octet-stream')
      ) {
        return;
      }
      let content = await readTextLimited(response, MAX_M3U8_BYTES);
      // 仅对 VOD/Master 更新缓存
      if (
        !content.includes('#EXT-X-ENDLIST') &&
        !content.includes('#EXT-X-STREAM-INF')
      ) {
        return;
      }
      // 针对特定源站尝试剔除广告段；失败或无信号时原样返回
      if (shouldRunAdDetection(source)) {
        try {
          content = await stripAdSegmentsByPhysicalSignal(
            content,
            response.url,
            ua,
          );
        } catch {
          /* 识别失败不影响缓存刷新 */
        }
      }
      m3u8Cache.set(url, {
        content,
        contentType,
        finalUrl: response.url,
      });
    } catch {
      /* 后台刷新失败保留旧值 */
    } finally {
      m3u8RefreshInflight.delete(url);
    }
  })();

  m3u8RefreshInflight.set(url, task);
  return task;
}

function getM3U8LoadInflightKey(
  url: string,
  ua: string,
  source: string | null,
  isLive: boolean,
  skipCache: boolean,
) {
  return [
    url,
    ua,
    source || '',
    isLive ? 'live' : 'vod',
    skipCache ? 'signed' : 'cacheable',
  ].join('\0');
}

async function fetchM3U8Data(
  url: string,
  ua: string,
  source: string | null,
  isLive: boolean,
  skipCache: boolean,
): Promise<M3U8LoadResult> {
  const response = await fetchWithUrlGuard(url, {
    cache: 'no-cache',
    redirect: 'follow',
    credentials: 'same-origin',
    headers: {
      'User-Agent': ua,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch m3u8');
  }

  const contentType =
    response.headers.get('Content-Type') || 'application/vnd.apple.mpegurl';
  const finalUrl = response.url;
  let content = await readTextLimited(response, MAX_M3U8_BYTES);

  if (!isLive && shouldRunAdDetection(source)) {
    try {
      content = await stripAdSegmentsByPhysicalSignal(content, finalUrl, ua);
    } catch {}
  }

  if (
    !skipCache &&
    (content.includes('#EXT-X-ENDLIST') ||
      content.includes('#EXT-X-STREAM-INF'))
  ) {
    m3u8Cache.set(url, {
      content,
      contentType,
      finalUrl,
    });
  }

  return {
    content,
    contentType,
    finalUrl,
    status: response.status,
    statusText: response.statusText,
  };
}

function loadM3U8Data(
  url: string,
  ua: string,
  source: string | null,
  isLive: boolean,
  skipCache: boolean,
): Promise<M3U8LoadResult> {
  const key = getM3U8LoadInflightKey(url, ua, source, isLive, skipCache);
  const existing = m3u8LoadInflight.get(key);
  if (existing) return existing;

  const task = fetchM3U8Data(url, ua, source, isLive, skipCache).finally(() => {
    m3u8LoadInflight.delete(key);
  });
  m3u8LoadInflight.set(key, task);
  return task;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const allowCORS = searchParams.get('allowCORS') === 'true';
  const forceServer = searchParams.get('forceServer') === 'true';
  const source = getProxySourceKey(searchParams);
  const isLive = searchParams.get('icetv-live') === '1';
  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  const validation = await validateProxyUrlForRequest(url);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 403 });
  }

  const authFailure = await authorizeProxyRequest(
    request,
    'm3u8',
    validation.url,
  );
  if (authFailure) {
    return authFailure;
  }

  const ua = await resolveProxyUserAgent(source);
  const skipCache = isSignedM3U8Url(validation.url);

  try {
    // 查询 VOD 清单缓存（fresh/stale 皆命中；stale 命中时触发后台刷新）
    const cached = skipCache ? null : m3u8Cache.peek(validation.url);
    if (cached) {
      const { value, fresh } = cached;
      if (!fresh) {
        // 软过期：后台刷新，不阻塞当前响应
        void refreshM3U8Cache(validation.url, ua, source);
      }
      const baseUrl = getBaseUrl(value.finalUrl);
      const modifiedContent = await rewriteM3U8Content(
        value.content,
        baseUrl,
        request,
        allowCORS,
        forceServer,
        source,
        isLive,
      );

      const headers = new Headers();
      headers.set('Content-Type', value.contentType);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Range, Origin, Accept',
      );
      headers.set('Cache-Control', 'no-cache');
      headers.set(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range',
      );
      return new Response(modifiedContent, { status: 200, headers });
    }

    const loaded = await loadM3U8Data(
      validation.url,
      ua,
      source,
      isLive,
      skipCache,
    );
    const baseUrl = getBaseUrl(loaded.finalUrl);
    const modifiedContent = await rewriteM3U8Content(
      loaded.content,
      baseUrl,
      request,
      allowCORS,
      forceServer,
      source,
      isLive,
    );
    const headers = new Headers();
    headers.set('Content-Type', loaded.contentType);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Range, Origin, Accept',
    );
    headers.set('Cache-Control', 'no-cache');
    headers.set(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range',
    );

    return new Response(modifiedContent, {
      status: loaded.status,
      statusText: loaded.statusText,
      headers,
    });
  } catch (error) {
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: error.reason }, { status: 403 });
    }
    if (error instanceof ResponseSizeLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }

    return NextResponse.json(
      { error: 'Failed to fetch m3u8' },
      { status: 500 },
    );
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
  const referer = req.headers.get('referer');
  let protocol = 'http';
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      protocol = refererUrl.protocol.replace(':', '');
    } catch (error) {
      // ignore
    }
  }

  const host = req.headers.get('host');
  const proxyBase = `${protocol}://${host}/api/proxy`;

  // 源站 CORS 能力探测结果：若已确认支持，即便 admin 将其标为 server-proxy，
  // 也把 segment / key URL 直接输出为源站原始 URL，省掉一跳服务端转发。
  // m3u8（master/variant）仍走代理，避免递归嵌套与 CORS 复杂度。
  // 直播场景跳过此优化：直播通常依赖服务端注入特定 UA / 处理鉴权，直连易失败。
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
              allowCORS ? { allowCORS: 'true' } : {},
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
