import { NextRequest, NextResponse } from 'next/server';

import { getConfigForRead } from '@/lib/config';
import {
  type CoverImageResizeOptions,
  CoverImageResizeParamError,
  parseCoverImageResizeOptions,
  resizeCoverImage,
} from '@/lib/cover-image-resize';
import { loadResizedCoverImage } from '@/lib/cover-image-resize-cache.server';
import {
  isHostLevelImageStatus,
  isImageHostCoolingDown,
  recordImageHostFailure,
  recordImageHostReachable,
} from '@/lib/image-proxy-host-health.server';
import { resolveProxyAuthorization } from '@/lib/proxy-auth';
import { getUpstreamFailureStatus } from '@/lib/proxy-diagnostics';
import {
  assertContentLength,
  createLimitedReadableStream,
  readArrayBufferLimited,
  ResponseSizeLimitError,
} from '@/lib/proxy-response-limits';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import {
  type ServerProxyKind,
  recordServerProxyFailure,
  requireServerProxyQuota,
} from '@/lib/server-proxy-guard';
import {
  ResourceLimitError,
  resourceLimitResponse,
} from '@/lib/server-resource-errors';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ORIGIN_FETCH_HEADERS = {
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
} as const;

class ImageOriginError extends Error {
  constructor(readonly reason: string | number) {
    super('图片获取失败');
    this.name = 'ImageOriginError';
  }
}

// 冷却期内直接判失败，不回源也不重复记失败日志
class ImageHostCoolingDownError extends ImageOriginError {
  constructor() {
    super('host-cooldown');
    this.name = 'ImageHostCoolingDownError';
  }
}

function getImageHostname(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
}

function isDoubanImageHost(hostname: string): boolean {
  return hostname === 'doubanio.com' || hostname.endsWith('.doubanio.com');
}

async function fetchImageOrigin(
  url: string,
  method: 'GET' | 'HEAD',
  timeoutMs: number,
): Promise<{ response: Response; contentType: string }> {
  const target = new URL(url);
  const hostname = getImageHostname(url);
  if (isImageHostCoolingDown(hostname)) {
    throw new ImageHostCoolingDownError();
  }

  let response: Response;
  try {
    response = await fetchWithUrlGuard(url, {
      method,
      // 重定向沿用初始图床的来源，避免把跳转后的 CDN 当作来源站点
      headers: {
        ...ORIGIN_FETCH_HEADERS,
        Referer: isDoubanImageHost(hostname)
          ? 'https://movie.douban.com/'
          : `${target.origin}/`,
      },
      skipInitialValidation: true,
      timeoutMs,
    });
  } catch (error) {
    // 本站资源额度与地址校验失败与源站可用性无关
    if (
      !(error instanceof ResourceLimitError) &&
      !(error instanceof UrlValidationError)
    ) {
      recordImageHostFailure(hostname);
    }
    throw error;
  }

  if (!response.ok) {
    if (isHostLevelImageStatus(response.status)) {
      recordImageHostFailure(hostname);
    } else {
      recordImageHostReachable(hostname);
    }
    await response.body?.cancel().catch(() => {});
    throw new ImageOriginError(response.status);
  }
  recordImageHostReachable(hostname);

  const contentType = response.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('image/')) {
    await response.body?.cancel().catch(() => {});
    throw new ImageOriginError(contentType || 'content-type');
  }
  if (method === 'GET' && !response.body) {
    throw new ImageOriginError('empty-body');
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

  const proxyKind: ServerProxyKind = isDoubanImageHost(
    getImageHostname(validation.url),
  )
    ? 'douban-image'
    : 'source-cover';
  const quotaFailure = await requireServerProxyQuota(
    proxyKind,
    request,
    authorization.via === 'session' ? authorization.username : undefined,
  );
  if (quotaFailure) return quotaFailure;

  const config = await getConfigForRead();
  const originTimeoutMs =
    normalizeRuntimeParams(config.SiteConfig).ImageProxyTimeoutSeconds * 1000;

  try {
    if (method === 'GET' && resizeOptions) {
      const resizeTarget = resizeOptions;
      const originUrl = validation.url;
      const resized = await loadResizedCoverImage(
        originUrl,
        resizeTarget,
        async () => {
          const { response } = await fetchImageOrigin(
            originUrl,
            method,
            originTimeoutMs,
          );
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
      originTimeoutMs,
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
      await imageResponse.body?.cancel().catch(() => {});
      return new Response(null, {
        status: 200,
        headers,
      });
    }

    try {
      assertContentLength(imageResponse.headers, MAX_IMAGE_BYTES);
    } catch (error) {
      await imageResponse.body?.cancel().catch(() => {});
      throw error;
    }

    return new Response(
      createLimitedReadableStream(imageResponse.body, MAX_IMAGE_BYTES),
      {
        status: 200,
        headers,
      },
    );
  } catch (error) {
    const busy = resourceLimitResponse(error);
    if (busy) return busy;
    if (error instanceof ImageOriginError) {
      if (!(error instanceof ImageHostCoolingDownError)) {
        recordServerProxyFailure(proxyKind, error.reason);
      }
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 403 });
    }
    if (error instanceof ResponseSizeLimitError) {
      recordServerProxyFailure(proxyKind, error);
      return NextResponse.json({ error: error.message }, { status: 413 });
    }

    recordServerProxyFailure(proxyKind, error);
    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: getUpstreamFailureStatus(error) },
    );
  }
}

function createImageProxyCacheHeaders(): Headers {
  const headers = new Headers();
  headers.set(
    'Cache-Control',
    'private, max-age=2592000, stale-while-revalidate=86400',
  );
  return headers;
}

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  return proxyImage(request, 'GET');
}

export async function HEAD(request: NextRequest) {
  return proxyImage(request, 'HEAD');
}
