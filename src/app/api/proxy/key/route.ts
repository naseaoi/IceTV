import { NextRequest, NextResponse } from 'next/server';

import { isLiveEntryEnabled } from '@/features/live/lib/live';
import { getConfigForRead } from '@/lib/config';
import {
  fetchResponseThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';
import { authorizeProxyRequest } from '@/lib/proxy-auth';
import {
  readArrayBufferLimited,
  ResponseSizeLimitError,
} from '@/lib/proxy-response-limits';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import { markSourceCors, responseAllowsCors } from '@/lib/source-capability';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

import { getProxySourceKey, resolveProxyUserAgent } from '../utils';

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

  const authFailure = await authorizeProxyRequest(request, 'key', url);
  if (authFailure) {
    return authFailure;
  }

  if (isLiveStream && !(await isLiveEntryEnabled())) {
    return NextResponse.json({ error: '直播未开启' }, { status: 404 });
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
          if (source) {
            markSourceCors(source, responseAllowsCors(response.headers));
          }
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
      skipInitialValidation: true,
      timeoutMs,
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch key' },
        { status: 500 },
      );
    }
    // key 与 segment 一样属于真实媒体资源，请求成功后可作为跨域能力依据。
    if (source) {
      markSourceCors(source, responseAllowsCors(response.headers));
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
