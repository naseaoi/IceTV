import { NextRequest, NextResponse } from 'next/server';

import {
  type CoverImageResizeOptions,
  CoverImageResizeParamError,
  parseCoverImageResizeOptions,
  resizeCoverImage,
} from '@/lib/cover-image-resize';
import { loadResizedCoverImage } from '@/lib/cover-image-resize-cache.server';
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

const ORIGIN_FETCH_HEADERS = {
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  Referer: 'https://movie.douban.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
} as const;

class ImageOriginError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | number,
    message: string,
  ) {
    super(message);
    this.name = 'ImageOriginError';
  }
}

async function fetchImageOrigin(
  url: string,
  method: 'GET' | 'HEAD',
): Promise<{ response: Response; contentType: string }> {
  const response = await fetchWithUrlGuard(url, {
    method,
    headers: ORIGIN_FETCH_HEADERS,
    skipInitialValidation: true,
  });

  if (!response.ok) {
    throw new ImageOriginError(
      response.status,
      response.status,
      response.statusText,
    );
  }

  const contentType = response.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('image/')) {
    throw new ImageOriginError(
      415,
      contentType || 'content-type',
      'Invalid image response',
    );
  }

  return { response, contentType };
}

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
    if (method === 'GET' && resizeOptions) {
      const resizeTarget = resizeOptions;
      const originUrl = validation.url;
      const resized = await loadResizedCoverImage(
        originUrl,
        resizeTarget,
        async () => {
          const { response } = await fetchImageOrigin(originUrl, method);
          const source = await readArrayBufferLimited(
            response,
            MAX_IMAGE_BYTES,
          );
          return resizeCoverImage(source, resizeTarget);
        },
      );

      const headers = createImageProxyCacheHeaders();
      headers.set('Content-Type', 'image/webp');
      headers.set('Content-Length', String(resized.byteLength));

      return new Response(resized, {
        status: 200,
        headers,
      });
    }

    const { response: imageResponse, contentType } = await fetchImageOrigin(
      validation.url,
      method,
    );

    // 创建响应头
    const headers = createImageProxyCacheHeaders();

    headers.set('Content-Type', contentType);
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
    if (error instanceof ImageOriginError) {
      recordServerProxyFailure('douban-image', error.reason);
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
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
