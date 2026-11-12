import { NextRequest, NextResponse } from 'next/server';

import {
  getProxySourceKey,
  resolveProxyUserAgent,
} from '@/app/api/proxy/utils';
import { getRewrittenM3U8Content } from '@/features/play/lib/m3u8-rewrite';
import { withSourceProbeBudget } from '@/features/play/lib/sourceProbeGuard.server';
import { getOptionalActiveUser } from '@/lib/api-auth';
import { getClientIp } from '@/lib/client-ip';
import { getConfigForRead } from '@/lib/config';
import {
  isServerRelayPaused,
  serverRelayPausedResponse,
} from '@/lib/host-traffic.server';
import { canUserWatchLive } from '@/lib/live-access.server';
import { resolveProxyAuthorization } from '@/lib/proxy-auth';
import {
  classifyProxyFailure,
  createProxyFailureDiagnostic,
  logProxyFailure,
  toProxyFailurePayload,
} from '@/lib/proxy-diagnostics';
import { requireServerProxyQuota } from '@/lib/server-proxy-guard';
import { resourceLimitResponse } from '@/lib/server-resource-errors';
import {
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

import {
  isSignedM3U8Url,
  loadM3U8Data,
  peekM3U8Cache,
  refreshM3U8Cache,
} from './service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return withSourceProbeBudget(request, handleGet);
}

async function handleGet(request: NextRequest) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const allowCORS = searchParams.get('allowCORS') === 'true';
  const forceServer = searchParams.get('forceServer') === 'true';
  const source = getProxySourceKey(searchParams);
  const isLive = searchParams.get('icetv-live') === '1';
  const warmOnly = !isLive && request.headers.get('x-icetv-warm-only') === '1';
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

  // 直连模式只代取清单、分片由浏览器直连，暂停时照常放行
  if (proxyMode === 'server-proxy' && (await isServerRelayPaused())) {
    return serverRelayPausedResponse();
  }

  const quotaFailure = await requireServerProxyQuota(
    'vod-m3u8',
    request,
    authorization.via === 'session' ? authorization.username : undefined,
  );
  if (quotaFailure) return quotaFailure;

  const identity =
    authorization.via === 'session'
      ? `user:${authorization.username}`
      : `ip:${getClientIp(request)}`;

  const proxyPoolStickyKey = isLive
    ? undefined
    : authorization.proxyPoolStickyKey;

  if (isLive) {
    const config = await getConfigForRead();
    if (config.SiteConfig.EnableLiveEntry !== true) {
      return NextResponse.json({ error: '直播未开启' }, { status: 404 });
    }
    const username =
      authorization.via === 'session'
        ? authorization.username
        : config.SiteConfig.LiveAccess === 'groups'
          ? (await getOptionalActiveUser(request))?.username
          : undefined;
    if (!(await canUserWatchLive(username, config))) {
      return NextResponse.json({ error: '没有直播权限' }, { status: 403 });
    }
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
      // 只进服务端日志，区分 DNS 解析失败与解析到内网等被拦截地址
      error: new UrlValidationError(validation.reason),
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

  const skipCache = isLive || isSignedM3U8Url(validation.url);
  if (warmOnly && skipCache) return warmOnlyResponse();
  const ua = await resolveProxyUserAgent(source);

  try {
    // 查询 VOD 清单缓存（fresh/stale 皆命中；stale 命中时触发后台刷新）
    const cached = skipCache ? null : peekM3U8Cache(validation.url, source);
    if (cached) {
      const { value, fresh } = cached;
      if (!fresh) {
        // 软过期：后台刷新，不阻塞当前响应
        void refreshM3U8Cache(
          validation.url,
          ua,
          source,
          isLive,
          identity,
          proxyPoolStickyKey,
        );
      }
      if (warmOnly) return warmOnlyResponse();
      const modifiedContent = await getRewrittenM3U8Content(
        value,
        validation.url,
        request,
        allowCORS,
        forceServer,
        source,
        isLive,
        !skipCache,
        proxyPoolStickyKey,
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
        identity,
        proxyPoolStickyKey,
        startedAt,
        proxyMode,
        userAction,
        userInitiated,
      },
    );
    if (warmOnly) return warmOnlyResponse();
    const modifiedContent = await getRewrittenM3U8Content(
      loaded,
      validation.url,
      request,
      allowCORS,
      forceServer,
      source,
      isLive,
      !skipCache,
      proxyPoolStickyKey,
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
    const busy = resourceLimitResponse(error);
    if (busy) return busy;
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

function warmOnlyResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function getPlaybackProxyMode(
  allowCORS: boolean,
  forceServer: boolean,
): string {
  if (forceServer) return 'server-proxy';
  return allowCORS ? 'browser-direct' : 'server-proxy';
}
