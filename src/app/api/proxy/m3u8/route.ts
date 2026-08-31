import { NextRequest, NextResponse } from 'next/server';

import { isLiveEntryEnabled } from '@/features/live/lib/live';
import { getRewrittenM3U8Content } from '@/features/play/lib/m3u8-rewrite';
import { resolveProxyAuthorization } from '@/lib/proxy-auth';
import {
  classifyProxyFailure,
  createProxyFailureDiagnostic,
  logProxyFailure,
  toProxyFailurePayload,
} from '@/lib/proxy-diagnostics';
import { requireServerProxyQuota } from '@/lib/server-proxy-guard';
import { validateProxyUrlForRequest } from '@/lib/url-guard';

import { getProxySourceKey, resolveProxyUserAgent } from '../utils';
import {
  isSignedM3U8Url,
  loadM3U8Data,
  peekM3U8Cache,
  refreshM3U8Cache,
} from './service';

export const runtime = 'nodejs';

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

  const authorization = await resolveProxyAuthorization(request, 'm3u8', url);
  if (!authorization.authorized) {
    const diagnostic = createProxyFailureDiagnostic({
      route: 'm3u8',
      source,
      targetUrl: url,
      stage: 'auth',
      reason: 'auth-failed',
      status: authorization.response.status || 403,
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

  const quotaFailure = requireServerProxyQuota(
    'vod-m3u8',
    request,
    authorization.via === 'session' ? authorization.username : undefined,
  );
  if (quotaFailure) return quotaFailure;

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
      message: 'Invalid URL',
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
    const cached = skipCache ? null : peekM3U8Cache(validation.url, source);
    if (cached) {
      const { value, fresh } = cached;
      if (!fresh) {
        // 软过期：后台刷新，不阻塞当前响应
        void refreshM3U8Cache(validation.url, ua, source);
      }
      const modifiedContent = await getRewrittenM3U8Content(
        value,
        validation.url,
        request,
        allowCORS,
        forceServer,
        source,
        isLive,
        !skipCache,
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
    const modifiedContent = await getRewrittenM3U8Content(
      loaded,
      validation.url,
      request,
      allowCORS,
      forceServer,
      source,
      isLive,
      !skipCache,
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

function getPlaybackProxyMode(
  allowCORS: boolean,
  forceServer: boolean,
): string {
  if (forceServer) return 'server-proxy';
  return allowCORS ? 'browser-direct' : 'server-proxy';
}
