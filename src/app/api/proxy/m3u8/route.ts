import { NextRequest, NextResponse } from 'next/server';

import {
  shouldRunAdDetection,
  stripAdSegmentsByPhysicalSignal,
} from '@/lib/ad-segment-detector';
import { getBaseUrl, resolveUrl } from '@/lib/live';
import { readTextLimited } from '@/lib/proxy-response-limits';
import { appendProxySignature, authorizeProxyRequest } from '@/lib/proxy-auth';
import {
  classifyProxyFailure,
  createProxyFailureDiagnostic,
  logProxyFailure,
  ProxyRouteError,
  toProxyFailurePayload,
} from '@/lib/proxy-diagnostics';
import { createSwrCache } from '@/lib/server-cache';
import { isSourceCorsCapable } from '@/lib/source-capability';
import { fetchWithUrlGuard, validateProxyUrlForRequest } from '@/lib/url-guard';
import { isLiveEntryEnabled } from '@/lib/live';
import {
  fetchResponseThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';

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

type M3U8ProxyRequestContext = {
  startedAt: number;
  proxyMode: string;
  userAction: string | null;
  userInitiated: boolean;
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
  context: M3U8ProxyRequestContext,
): Promise<M3U8LoadResult> {
  if (isLive) {
    const proxyUrl = getProxyUrlForTarget(new URL(url));
    if (proxyUrl) {
      try {
        const response = await fetchResponseThroughProxy(
          new URL(url),
          proxyUrl,
          {
            timeoutMs: 15_000,
            userAgent: ua,
            maxBytes: MAX_M3U8_BYTES,
            accept: 'application/vnd.apple.mpegurl,text/plain,*/*',
          },
        );
        const content = response.body.toString('utf8');
        const contentType = response.headers.get('content-type') || '';
        assertM3U8Content(content, contentType, {
          route: 'm3u8',
          source,
          targetUrl: url,
          proxyUrl,
          stage: 'response',
          reason: 'content-type',
          upstreamStatus: response.status,
          status: 502,
          elapsedMs: Date.now() - context.startedAt,
          proxyMode: 'env-proxy',
          isLive,
          userAction: context.userAction,
          userInitiated: context.userInitiated,
        });
        return {
          content,
          contentType: contentType || 'application/vnd.apple.mpegurl',
          finalUrl: url,
          status: response.status,
          statusText: response.statusText,
        };
      } catch (error) {
        logProxyFailure(
          classifyProxyFailure(error, {
            route: 'm3u8',
            source,
            targetUrl: url,
            proxyUrl,
            stage: 'proxy',
            reason: 'proxy-response',
            status: 502,
            elapsedMs: Date.now() - context.startedAt,
            proxyMode: 'env-proxy',
            isLive,
            userAction: context.userAction,
            userInitiated: context.userInitiated,
          }),
        );
      }
    }
  }

  const response = await fetchWithUrlGuard(url, {
    cache: 'no-cache',
    redirect: 'follow',
    credentials: 'same-origin',
    headers: {
      'User-Agent': ua,
    },
  });

  if (!response.ok) {
    throw new ProxyRouteError({
      route: 'm3u8',
      source,
      targetUrl: response.url || url,
      stage: 'upstream',
      reason: 'upstream-http',
      upstreamStatus: response.status,
      status: response.status,
      message: `Upstream m3u8 returned HTTP ${response.status}`,
      elapsedMs: Date.now() - context.startedAt,
      proxyMode: context.proxyMode,
      isLive,
      userAction: context.userAction,
      userInitiated: context.userInitiated,
    });
  }

  const contentType = response.headers.get('Content-Type') || '';
  const finalUrl = response.url;
  let content = await readTextLimited(response, MAX_M3U8_BYTES);
  assertM3U8Content(content, contentType, {
    route: 'm3u8',
    source,
    targetUrl: finalUrl || url,
    stage: 'response',
    reason: 'content-type',
    upstreamStatus: response.status,
    status: 502,
    elapsedMs: Date.now() - context.startedAt,
    proxyMode: context.proxyMode,
    isLive,
    userAction: context.userAction,
    userInitiated: context.userInitiated,
  });

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
      contentType: contentType || 'application/vnd.apple.mpegurl',
      finalUrl,
    });
  }

  return {
    content,
    contentType: contentType || 'application/vnd.apple.mpegurl',
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
  context: M3U8ProxyRequestContext,
): Promise<M3U8LoadResult> {
  const key = getM3U8LoadInflightKey(url, ua, source, isLive, skipCache);
  const existing = m3u8LoadInflight.get(key);
  if (existing) return existing;

  const task = fetchM3U8Data(
    url,
    ua,
    source,
    isLive,
    skipCache,
    context,
  ).finally(() => {
    m3u8LoadInflight.delete(key);
  });
  m3u8LoadInflight.set(key, task);
  return task;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const allowCORS = searchParams.get('allowCORS') === 'true';
  const forceServer = searchParams.get('forceServer') === 'true';
  const source = getProxySourceKey(searchParams);
  const isLive = searchParams.get('icetv-live') === '1';
  const proxyMode = getPlaybackProxyMode(allowCORS, forceServer);
  const userAction = searchParams.get('icetv-switch');
  const userInitiated = searchParams.get('icetv-user-switch') === '1';
  if (!url) {
    const diagnostic = createProxyFailureDiagnostic({
      route: 'm3u8',
      source,
      stage: 'request',
      reason: 'missing-url',
      elapsedMs: Date.now() - startedAt,
      proxyMode,
      isLive,
      userAction,
      userInitiated,
    });
    logProxyFailure(diagnostic);
    return NextResponse.json(toProxyFailurePayload(diagnostic), {
      status: diagnostic.status,
    });
  }

  if (isLive && !(await isLiveEntryEnabled())) {
    return NextResponse.json({ error: '直播未开启' }, { status: 404 });
  }

  const validation = await validateProxyUrlForRequest(url);
  if (!validation.ok) {
    const diagnostic = createProxyFailureDiagnostic({
      route: 'm3u8',
      source,
      targetUrl: url,
      stage: 'validation',
      reason: 'invalid-url',
      status: 403,
      message: validation.reason,
      elapsedMs: Date.now() - startedAt,
      proxyMode,
      isLive,
      userAction,
      userInitiated,
    });
    logProxyFailure(diagnostic);
    return NextResponse.json(toProxyFailurePayload(diagnostic), {
      status: diagnostic.status,
    });
  }

  const authFailure = await authorizeProxyRequest(
    request,
    'm3u8',
    validation.url,
  );
  if (authFailure) {
    const diagnostic = createProxyFailureDiagnostic({
      route: 'm3u8',
      source,
      targetUrl: validation.url,
      stage: 'auth',
      reason: 'auth-failed',
      status: authFailure.status || 403,
      elapsedMs: Date.now() - startedAt,
      proxyMode,
      isLive,
      userAction,
      userInitiated,
    });
    logProxyFailure(diagnostic);
    return NextResponse.json(toProxyFailurePayload(diagnostic), {
      status: diagnostic.status,
    });
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
      {
        startedAt,
        proxyMode,
        userAction,
        userInitiated,
      },
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
    const diagnostic = classifyProxyFailure(error, {
      route: 'm3u8',
      source,
      targetUrl: validation.url,
      stage: 'upstream',
      reason: 'upstream-fetch',
      status: 500,
      elapsedMs: Date.now() - startedAt,
      proxyMode,
      isLive,
      userAction,
      userInitiated,
    });
    logProxyFailure(diagnostic);
    return NextResponse.json(toProxyFailurePayload(diagnostic), {
      status: diagnostic.status,
    });
  }
}

function assertM3U8Content(
  content: string,
  contentType: string,
  context: ConstructorParameters<typeof ProxyRouteError>[0],
): void {
  if (content.includes('#EXTM3U')) {
    return;
  }

  const normalized = contentType.toLowerCase();
  if (
    normalized.includes('mpegurl') ||
    normalized.includes('octet-stream') ||
    normalized.includes('text/plain')
  ) {
    return;
  }

  throw new ProxyRouteError({
    ...context,
    message: `Unexpected m3u8 content type: ${contentType || 'empty'}`,
  });
}

function getPlaybackProxyMode(
  allowCORS: boolean,
  forceServer: boolean,
): string {
  if (forceServer) return 'server-proxy';
  return allowCORS ? 'browser-direct' : 'server-proxy';
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
  const requestSearchParams = new URL(req.url).searchParams;
  const switchAction = requestSearchParams.get('icetv-switch');
  const userSwitch = requestSearchParams.get('icetv-user-switch');

  // 源站 CORS 能力探测结果：若已确认支持，即便 admin 将其标为 server-proxy，
  // 也把 segment / key URL 直接输出为源站原始 URL，省掉一跳服务端转发。
  // m3u8（master/variant）仍走代理，避免递归嵌套与 CORS 复杂度。
  // 直播场景跳过此优化：直播通常依赖服务端注入特定 UA / 处理鉴权，直连易失败。
  const corsCapable =
    !isLive && source ? isSourceCorsCapable(source) === true : false;
  const effectiveAllowCors =
    !isLive && !forceServer && (allowCORS || corsCapable);

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
