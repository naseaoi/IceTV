import { NextRequest, NextResponse } from 'next/server';

import { authorizeProxyRequest } from '@/lib/proxy-auth';
import {
  fetchStreamThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';
import { isLiveEntryEnabled } from '@/features/live/lib/live';
import {
  assertContentLength,
  createLimitedReadableStream,
} from '@/lib/proxy-response-limits';
import {
  classifyProxyFailure,
  createProxyFailureDiagnostic,
  logProxyFailure,
  ProxyRouteError,
  toProxyFailurePayload,
} from '@/lib/proxy-diagnostics';
import { markSourceCors, responseAllowsCors } from '@/lib/source-capability';
import { fetchWithUrlGuard, validateProxyUrlForRequest } from '@/lib/url-guard';

import { getProxySourceKey, resolveProxyUserAgent } from '../utils';

export const runtime = 'nodejs';

const MAX_SEGMENT_BYTES = 256 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = getProxySourceKey(searchParams);
  // 判断是否直播：显式 icetv-live 标记（新）或仅凭 source 存在（旧兼容）。
  // 点播场景下 m3u8 URL 现在也携带 source 做 CORS 能力探测，因此不能再把
  // "有 source" 一律视为直播，否则点播分片会被标 no-cache 影响 HTTP 缓存。
  const isLiveStream = searchParams.get('icetv-live') === '1';
  const proxyMode = 'server-proxy';
  const userAction = searchParams.get('icetv-switch');
  const userInitiated = searchParams.get('icetv-user-switch') === '1';
  const range = request.headers.get('range');
  if (!url) {
    const diagnostic = createProxyFailureDiagnostic({
      route: 'segment',
      source,
      stage: 'request',
      reason: 'missing-url',
      elapsedMs: Date.now() - startedAt,
      proxyMode,
      isLive: isLiveStream,
      userAction,
      userInitiated,
    });
    logProxyFailure(diagnostic);
    return NextResponse.json(toProxyFailurePayload(diagnostic), {
      status: diagnostic.status,
    });
  }

  if (isLiveStream && !(await isLiveEntryEnabled())) {
    return NextResponse.json({ error: '直播未开启' }, { status: 404 });
  }

  const validation = await validateProxyUrlForRequest(url);
  if (!validation.ok) {
    const diagnostic = createProxyFailureDiagnostic({
      route: 'segment',
      source,
      targetUrl: url,
      stage: 'validation',
      reason: 'invalid-url',
      status: 403,
      message: validation.reason,
      elapsedMs: Date.now() - startedAt,
      proxyMode,
      isLive: isLiveStream,
      range,
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
    'segment',
    validation.url,
  );
  if (authFailure) {
    const diagnostic = createProxyFailureDiagnostic({
      route: 'segment',
      source,
      targetUrl: validation.url,
      stage: 'auth',
      reason: 'auth-failed',
      status: authFailure.status || 403,
      elapsedMs: Date.now() - startedAt,
      proxyMode,
      isLive: isLiveStream,
      range,
      userAction,
      userInitiated,
    });
    logProxyFailure(diagnostic);
    return NextResponse.json(toProxyFailurePayload(diagnostic), {
      status: diagnostic.status,
    });
  }

  const ua = await resolveProxyUserAgent(source);

  try {
    const headers: Record<string, string> = {
      'User-Agent': ua,
    };
    if (range) {
      headers.Range = range;
    }

    if (isLiveStream) {
      const proxyUrl = getProxyUrlForTarget(new URL(validation.url));
      if (proxyUrl) {
        try {
          const response = await fetchStreamThroughProxy(
            new URL(validation.url),
            proxyUrl,
            {
              timeoutMs: 20_000,
              userAgent: ua,
              maxBytes: MAX_SEGMENT_BYTES,
              accept: '*/*',
              headers,
            },
          );
          assertContentLength(response.headers, MAX_SEGMENT_BYTES);
          assertSegmentContentType(response.headers, {
            route: 'segment',
            source,
            targetUrl: validation.url,
            proxyUrl,
            stage: 'response',
            reason: 'content-type',
            upstreamStatus: response.status,
            status: 502,
            elapsedMs: Date.now() - startedAt,
            proxyMode: 'env-proxy',
            isLive: isLiveStream,
            range,
            userAction,
            userInitiated,
          });

          if (source) {
            markSourceCors(source, responseAllowsCors(response.headers));
          }

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: buildSegmentResponseHeaders(response.headers, true),
          });
        } catch (error) {
          logProxyFailure(
            classifyProxyFailure(error, {
              route: 'segment',
              source,
              targetUrl: validation.url,
              proxyUrl,
              stage: 'proxy',
              reason: 'proxy-response',
              status: 502,
              elapsedMs: Date.now() - startedAt,
              proxyMode: 'env-proxy',
              isLive: isLiveStream,
              range,
              userAction,
              userInitiated,
            }),
          );
        }
      }
    }

    const response = await fetchWithUrlGuard(validation.url, { headers });
    if (!response.ok) {
      const diagnostic = createProxyFailureDiagnostic({
        route: 'segment',
        source,
        targetUrl: response.url || validation.url,
        stage: 'upstream',
        reason: 'upstream-http',
        upstreamStatus: response.status,
        status: response.status,
        message: `Upstream segment returned HTTP ${response.status}`,
        elapsedMs: Date.now() - startedAt,
        proxyMode,
        isLive: isLiveStream,
        range,
        userAction,
        userInitiated,
      });
      logProxyFailure(diagnostic);
      return NextResponse.json(toProxyFailurePayload(diagnostic), {
        status: diagnostic.status,
      });
    }
    assertContentLength(response.headers, MAX_SEGMENT_BYTES);
    assertSegmentContentType(response.headers, {
      route: 'segment',
      source,
      targetUrl: response.url || validation.url,
      stage: 'response',
      reason: 'content-type',
      upstreamStatus: response.status,
      status: 502,
      elapsedMs: Date.now() - startedAt,
      proxyMode,
      isLive: isLiveStream,
      range,
      userAction,
      userInitiated,
    });

    // 只用真实 segment 响应学习跨域能力，避免被 m3u8 响应头误导。
    if (source) {
      markSourceCors(source, responseAllowsCors(response.headers));
    }

    const responseHeaders = buildSegmentResponseHeaders(
      response.headers,
      isLiveStream,
    );

    return new Response(
      createLimitedReadableStream(response.body, MAX_SEGMENT_BYTES),
      {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      },
    );
  } catch (error) {
    const diagnostic = classifyProxyFailure(error, {
      route: 'segment',
      source,
      targetUrl: validation.url,
      stage: 'upstream',
      reason: 'upstream-fetch',
      status: 500,
      elapsedMs: Date.now() - startedAt,
      proxyMode,
      isLive: isLiveStream,
      range,
      userAction,
      userInitiated,
    });
    logProxyFailure(diagnostic);
    return NextResponse.json(toProxyFailurePayload(diagnostic), {
      status: diagnostic.status,
    });
  }
}

function assertSegmentContentType(
  headers: Headers,
  context: ConstructorParameters<typeof ProxyRouteError>[0],
): void {
  const contentType = headers.get('content-type')?.toLowerCase() || '';
  if (!contentType) return;
  if (
    !contentType.includes('text/html') &&
    !contentType.includes('application/json')
  ) {
    return;
  }

  throw new ProxyRouteError({
    ...context,
    message: `Unexpected segment content type: ${contentType}`,
  });
}

function buildSegmentResponseHeaders(
  sourceHeaders: Headers,
  isLiveStream: boolean,
) {
  const responseHeaders = new Headers();
  responseHeaders.set('Access-Control-Allow-Origin', '*');
  responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  responseHeaders.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Range, Origin, Accept',
  );
  responseHeaders.set(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range',
  );
  responseHeaders.set(
    'Cache-Control',
    isLiveStream
      ? 'no-cache'
      : 'public, max-age=3600, stale-while-revalidate=300',
  );

  const contentType = sourceHeaders.get('content-type');
  if (contentType) {
    responseHeaders.set('Content-Type', contentType);
  }

  const contentLength = sourceHeaders.get('content-length');
  if (contentLength) {
    responseHeaders.set('Content-Length', contentLength);
  }

  const acceptRanges = sourceHeaders.get('accept-ranges');
  if (acceptRanges) {
    responseHeaders.set('Accept-Ranges', acceptRanges);
  }

  const contentRange = sourceHeaders.get('content-range');
  if (contentRange) {
    responseHeaders.set('Content-Range', contentRange);
  }

  return responseHeaders;
}
