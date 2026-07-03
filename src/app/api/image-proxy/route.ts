import { NextRequest, NextResponse } from 'next/server';

import { authorizeProxyRequest } from '@/lib/proxy-auth';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';
import {
  assertContentLength,
  createLimitedReadableStream,
  ResponseSizeLimitError,
} from '@/lib/proxy-response-limits';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function proxyImage(request: NextRequest, method: 'GET' | 'HEAD') {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  const validation = await validateProxyUrlForRequest(imageUrl);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 403 });
  }

  const authFailure = await authorizeProxyRequest(
    request,
    'image',
    validation.url,
  );
  if (authFailure) {
    return authFailure;
  }

  try {
    const imageResponse = await fetchWithUrlGuard(validation.url, {
      method,
      headers: {
        Accept:
          'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        Referer: 'https://movie.douban.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
      skipInitialValidation: true,
    });

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: imageResponse.statusText },
        { status: imageResponse.status },
      );
    }

    // 创建响应头
    const headers = new Headers();
    const contentType = imageResponse.headers.get('content-type');
    if (!contentType?.toLowerCase().startsWith('image/')) {
      return NextResponse.json(
        { error: 'Invalid image response' },
        { status: 415 },
      );
    }

    if (contentType) {
      headers.set('Content-Type', contentType);
    }
    const contentLength = imageResponse.headers.get('content-length');
    const etag = imageResponse.headers.get('etag');
    const lastModified = imageResponse.headers.get('last-modified');

    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }
    if (etag) {
      headers.set('ETag', etag);
    }
    if (lastModified) {
      headers.set('Last-Modified', lastModified);
    }

    // 设置缓存头，便于浏览器与 SW 做跨会话复用。
    headers.set(
      'Cache-Control',
      'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400',
    );
    headers.set('CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Netlify-Vary', 'query');

    if (method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers,
      });
    }

    assertContentLength(imageResponse.headers, MAX_IMAGE_BYTES);

    return new Response(
      createLimitedReadableStream(imageResponse.body, MAX_IMAGE_BYTES),
      {
        status: 200,
        headers,
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
      { error: 'Error fetching image' },
      { status: 500 },
    );
  }
}

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  return proxyImage(request, 'GET');
}

export async function HEAD(request: NextRequest) {
  return proxyImage(request, 'HEAD');
}
