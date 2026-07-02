import { NextRequest, NextResponse } from 'next/server';

import { getBangumiCoverTargetUrl } from '@/features/bangumi/lib/bangumi-cover-url';
import {
  fetchStreamThroughProxy,
  getProxyUrlForTarget,
  type ProxyStreamResult,
} from '@/lib/http-proxy-json';
import {
  assertContentLength,
  createLimitedReadableStream,
  ResponseSizeLimitError,
} from '@/lib/proxy-response-limits';
import { fetchWithUrlGuard, UrlValidationError } from '@/lib/url-guard';

export const runtime = 'nodejs';

const BANGUMI_COVER_MAX_BYTES = 8 * 1024 * 1024;
const BANGUMI_COVER_TIMEOUT_MS = 15_000;
const BANGUMI_COVER_ACCEPT =
  'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';
const BANGUMI_COVER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

async function handleBangumiCover(
  context: RouteContext,
  method: 'GET' | 'HEAD',
) {
  const { path = [] } = await context.params;
  const targetUrl = getBangumiCoverTargetUrl(path);

  if (!targetUrl) {
    return NextResponse.json(
      { error: 'Invalid Bangumi cover' },
      { status: 400 },
    );
  }

  try {
    const imageResponse = await fetchBangumiCover(targetUrl, method);
    const responseHeaders = createBangumiCoverHeaders(imageResponse.headers);

    if (!responseHeaders) {
      imageResponse.body?.cancel().catch(() => {});
      return NextResponse.json(
        { error: 'Invalid image response' },
        { status: 415 },
      );
    }

    if (method === 'HEAD') {
      imageResponse.body?.cancel().catch(() => {});
      return new Response(null, {
        status: 200,
        headers: responseHeaders,
      });
    }

    assertContentLength(imageResponse.headers, BANGUMI_COVER_MAX_BYTES);

    return new Response(
      createLimitedReadableStream(imageResponse.body, BANGUMI_COVER_MAX_BYTES),
      {
        status: 200,
        headers: responseHeaders,
      },
    );
  } catch (error) {
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: error.reason }, { status: 403 });
    }
    if (error instanceof ResponseSizeLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }

    return NextResponse.json(
      { error: 'Error fetching Bangumi cover' },
      { status: 502 },
    );
  }
}

async function fetchBangumiCover(
  targetUrl: URL,
  method: 'GET' | 'HEAD',
): Promise<ProxyStreamResult> {
  const proxyUrl = getProxyUrlForTarget(targetUrl);
  if (proxyUrl) {
    return fetchStreamThroughProxy(targetUrl, proxyUrl, {
      timeoutMs: BANGUMI_COVER_TIMEOUT_MS,
      userAgent: BANGUMI_COVER_USER_AGENT,
      maxBytes: BANGUMI_COVER_MAX_BYTES,
      accept: BANGUMI_COVER_ACCEPT,
      headers: {
        Referer: 'https://bgm.tv/',
      },
    });
  }

  const response = await fetchWithUrlGuard(targetUrl.toString(), {
    method,
    headers: {
      Accept: BANGUMI_COVER_ACCEPT,
      Referer: 'https://bgm.tv/',
      'User-Agent': BANGUMI_COVER_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Bangumi cover request failed: ${response.status}`);
  }
  if (!response.body) {
    throw new Error('Bangumi cover response is empty');
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: response.body,
  };
}

function createBangumiCoverHeaders(sourceHeaders: Headers): Headers | null {
  const contentType = sourceHeaders.get('content-type');
  if (!contentType?.toLowerCase().startsWith('image/')) {
    return null;
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType);

  const contentLength = sourceHeaders.get('content-length');
  const etag = sourceHeaders.get('etag');
  const lastModified = sourceHeaders.get('last-modified');

  if (contentLength) {
    headers.set('Content-Length', contentLength);
  }
  if (etag) {
    headers.set('ETag', etag);
  }
  if (lastModified) {
    headers.set('Last-Modified', lastModified);
  }

  headers.set(
    'Cache-Control',
    'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400',
  );
  headers.set('CDN-Cache-Control', 'public, s-maxage=15720000');
  headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=15720000');

  return headers;
}

export async function GET(request: NextRequest, context: RouteContext) {
  void request;
  return handleBangumiCover(context, 'GET');
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  void request;
  return handleBangumiCover(context, 'HEAD');
}
