import { NextRequest, NextResponse } from 'next/server';

import {
  type CoverImageResizeOptions,
  CoverImageResizeParamError,
  parseCoverImageResizeOptions,
  resizeCoverImage,
} from '@/lib/cover-image-resize';
import { resolveProxyAuthorization } from '@/lib/proxy-auth';
import {
  assertContentLength,
  createLimitedReadableStream,
  readArrayBufferLimited,
  ResponseSizeLimitError,
} from '@/lib/proxy-response-limits';
import {
  recordServerProxyFailure,
  requireServerProxyQuota,
} from '@/lib/server-proxy-guard';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function proxyImage(request: NextRequest, method: 'GET' | 'HEAD') {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  const authorization = await resolveProxyAuthorization(
    request,
    'image',
    imageUrl,
  );
  if (!authorization.authorized) {
    return authorization.response;
  }

  let resizeOptions: CoverImageResizeOptions | null;
  try {
    resizeOptions = parseCoverImageResizeOptions(searchParams);
  } catch (error) {
    if (error instanceof CoverImageResizeParamError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const validation = await validateProxyUrlForRequest(imageUrl);
  if (!validation.ok) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 403 });
  }

  const quotaFailure = requireServerProxyQuota(
    'douban-image',
    request,
    authorization.via === 'session' ? authorization.username : undefined,
  );
  if (quotaFailure) return quotaFailure;

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
      recordServerProxyFailure('douban-image', imageResponse.status);
      return NextResponse.json(
        { error: imageResponse.statusText },
        { status: imageResponse.status },
      );
    }

    const contentType = imageResponse.headers.get('content-type');
    if (!contentType?.toLowerCase().startsWith('image/')) {
      recordServerProxyFailure('douban-image', contentType || 'content-type');
      return NextResponse.json(
        { error: 'Invalid image response' },
        { status: 415 },
      );
    }

    if (method === 'GET' && resizeOptions) {
      const source = await readArrayBufferLimited(
        imageResponse,
        MAX_IMAGE_BYTES,
      );
      const resized = await resizeCoverImage(source, resizeOptions);
      const headers = createImageProxyCacheHeaders();
      headers.set('Content-Type', 'image/webp');
      headers.set('Content-Length', String(resized.byteLength));

      return new Response(resized, {
        status: 200,
        headers,
      });
    }

    // 创建响应头
    const headers = createImageProxyCacheHeaders();

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
      return NextResponse.json({ error: 'Invalid URL' }, { status: 403 });
    }
    if (error instanceof ResponseSizeLimitError) {
      recordServerProxyFailure('douban-image', error);
      return NextResponse.json({ error: error.message }, { status: 413 });
    }

    recordServerProxyFailure('douban-image', error);
    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: 500 },
    );
  }
}

function createImageProxyCacheHeaders(): Headers {
  const headers = new Headers();
  headers.set(
    'Cache-Control',
    'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400',
  );
  headers.set('CDN-Cache-Control', 'public, s-maxage=15720000');
  headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=15720000');
  headers.set('Netlify-Vary', 'query');
  return headers;
}

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  return proxyImage(request, 'GET');
}

export async function HEAD(request: NextRequest) {
  return proxyImage(request, 'HEAD');
}
