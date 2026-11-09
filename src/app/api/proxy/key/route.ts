import { NextRequest, NextResponse } from 'next/server';

import {
  getProxySourceKey,
  resolveProxyUserAgent,
} from '@/app/api/proxy/utils';
import { getOptionalActiveUser } from '@/lib/api-auth';
import { getClientIp } from '@/lib/client-ip';
import { getConfigForRead } from '@/lib/config';
import {
  fetchResponseThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';
import { canUserWatchLive } from '@/lib/live-access.server';
import { resolveProxyAuthorization } from '@/lib/proxy-auth';
import {
  readArrayBufferLimited,
  ResponseSizeLimitError,
} from '@/lib/proxy-response-limits';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

export const runtime = 'nodejs';

const MAX_KEY_BYTES = 1024 * 1024;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = getProxySourceKey(searchParams);
  const isLiveStream = searchParams.get('icetv-live') === '1';
  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  const authorization = await resolveProxyAuthorization(request, 'key', url);
  if (!authorization.authorized) {
    return authorization.response;
  }

  if (isLiveStream) {
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
    return NextResponse.json({ error: 'Invalid URL' }, { status: 403 });
  }

  const ua = await resolveProxyUserAgent(source);
  const runtimeParams = normalizeRuntimeParams(
    (await getConfigForRead()).SiteConfig,
  );
  const timeoutMs = runtimeParams.ProxyRequestTimeoutSeconds * 1000;

  try {
    if (isLiveStream) {
      const proxyUrl = getProxyUrlForTarget(new URL(validation.url));
      if (proxyUrl) {
        try {
          const response = await fetchResponseThroughProxy(
            new URL(validation.url),
            proxyUrl,
            {
              timeoutMs,
              userAgent: ua,
              maxBytes: MAX_KEY_BYTES,
              accept: '*/*',
            },
          );
          return new Response(bufferToArrayBuffer(response.body), {
            status: response.status,
            statusText: response.statusText,
            headers: {
              'Content-Type':
                response.headers.get('content-type') ||
                'application/octet-stream',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Cache-Control': 'no-cache',
            },
          });
        } catch (proxyError) {
          console.warn('代理 key 环境代理回源失败:', proxyError);
        }
      }
    }

    const response = await fetchWithUrlGuard(validation.url, {
      headers: {
        'User-Agent': ua,
      },
      resourceContext: {
        identity:
          authorization.via === 'session'
            ? `user:${authorization.username}`
            : `ip:${getClientIp(request)}`,
      },
      useProxyPool: !isLiveStream,
      skipInitialValidation: true,
      timeoutMs,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return NextResponse.json(
        { error: 'Failed to fetch key' },
        { status: 500 },
      );
    }
    const keyData = await readArrayBufferLimited(response, MAX_KEY_BYTES);
    return new Response(keyData, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Content-Type':
          response.headers.get('Content-Type') || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 403 });
    }
    if (error instanceof ResponseSizeLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }

    return NextResponse.json({ error: 'Failed to fetch key' }, { status: 500 });
  }
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}
