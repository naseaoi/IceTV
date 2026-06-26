import { NextResponse } from 'next/server';

import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

export const runtime = 'nodejs';

async function proxyImage(request: Request, method: 'GET' | 'HEAD') {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  const validation = await validateProxyUrlForRequest(imageUrl);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 403 });
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

    if (!imageResponse.body) {
      return NextResponse.json(
        { error: 'Image response has no body' },
        { status: 500 },
      );
    }

    // 直接返回图片流
    return new Response(imageResponse.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: error.reason }, { status: 403 });
    }

    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: 500 },
    );
  }
}

// OrionTV 兼容接口
export async function GET(request: Request) {
  return proxyImage(request, 'GET');
}

export async function HEAD(request: Request) {
  return proxyImage(request, 'HEAD');
}
