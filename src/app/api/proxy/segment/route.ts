import { NextRequest, NextResponse } from 'next/server';

import { authorizeProxyRequest } from '@/lib/proxy-auth';
import {
  assertContentLength,
  createLimitedReadableStream,
  ResponseSizeLimitError,
} from '@/lib/proxy-response-limits';
import { markSourceCors, responseAllowsCors } from '@/lib/source-capability';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

import { getProxySourceKey, resolveProxyUserAgent } from '../utils';

export const runtime = 'nodejs';

const MAX_SEGMENT_BYTES = 256 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = getProxySourceKey(searchParams);
  // 判断是否直播：显式 icetv-live 标记（新）或仅凭 source 存在（旧兼容）。
  // 点播场景下 m3u8 URL 现在也携带 source 做 CORS 能力探测，因此不能再把
  // "有 source" 一律视为直播，否则点播分片会被标 no-cache 影响 HTTP 缓存。
  const isLiveStream = searchParams.get('icetv-live') === '1';
  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  const validation = await validateProxyUrlForRequest(url);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 403 });
  }

  const authFailure = await authorizeProxyRequest(
    request,
    'segment',
    validation.url,
  );
  if (authFailure) {
    return authFailure;
  }

  const ua = await resolveProxyUserAgent(source);
  const range = request.headers.get('range');

  try {
    const headers: Record<string, string> = {
      'User-Agent': ua,
    };
    if (range) {
      headers.Range = range;
    }

    const response = await fetchWithUrlGuard(validation.url, { headers });
    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch segment' },
        { status: response.status },
      );
    }
    assertContentLength(response.headers, MAX_SEGMENT_BYTES);

    // 只用真实 segment 响应学习跨域能力，避免被 m3u8 响应头误导。
    if (source) {
      markSourceCors(source, responseAllowsCors(response.headers));
    }

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
    // 直播分片必须实时回源，点播分片则允许浏览器短时复用。
    responseHeaders.set(
      'Cache-Control',
      isLiveStream
        ? 'no-cache'
        : 'public, max-age=3600, stale-while-revalidate=300',
    );

    const contentType = response.headers.get('content-type');
    if (contentType) {
      responseHeaders.set('Content-Type', contentType);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength);
    }

    const acceptRanges = response.headers.get('accept-ranges');
    if (acceptRanges) {
      responseHeaders.set('Accept-Ranges', acceptRanges);
    }

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      responseHeaders.set('Content-Range', contentRange);
    }

    return new Response(
      createLimitedReadableStream(response.body, MAX_SEGMENT_BYTES),
      {
        status: response.status,
        statusText: response.statusText,
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
      { error: 'Failed to fetch segment' },
      { status: 500 },
    );
  }
}
