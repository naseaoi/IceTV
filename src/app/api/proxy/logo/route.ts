import { NextRequest, NextResponse } from 'next/server';

import { getConfigForRead } from '@/lib/config';
import {
  fetchResponseThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';
import { authorizeProxyRequest } from '@/lib/proxy-auth';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';
import {
  readArrayBufferLimited,
  ResponseSizeLimitError,
} from '@/lib/proxy-response-limits';
import { normalizeRuntimeParams } from '@/lib/runtime-params';

export const runtime = 'nodejs';

const MAX_LOGO_BYTES = 10 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');
  const source =
    searchParams.get('icetv-source') ||
    searchParams.get('moontv-source') ||
    searchParams.get('source');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  const authFailure = await authorizeProxyRequest(request, 'logo', imageUrl);
  if (authFailure) {
    return authFailure;
  }

  const validation = await validateProxyUrlForRequest(imageUrl);
  if (!validation.ok) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 403 });
  }

  const config = await getConfigForRead();
  const runtimeParams = normalizeRuntimeParams(config.SiteConfig);
  const timeoutMs = runtimeParams.ProxyRequestTimeoutSeconds * 1000;
  const liveSource = config.LiveConfig?.find((s: any) => s.key === source);
  const ua = liveSource?.ua || 'AptvPlayer/1.4.10';

  try {
    const imageResponse = await fetchWithUrlGuard(validation.url, {
      cache: 'no-cache',
      redirect: 'follow',
      credentials: 'same-origin',
      headers: {
        'User-Agent': ua,
      },
      skipInitialValidation: true,
      timeoutMs,
    });

    return await buildLogoResponse(imageResponse);
  } catch (error) {
    const proxyUrl = getProxyUrlForTarget(new URL(validation.url));
    if (proxyUrl) {
      try {
        const response = await fetchResponseThroughProxy(
          new URL(validation.url),
          proxyUrl,
          {
            timeoutMs,
            userAgent: ua,
            maxBytes: MAX_LOGO_BYTES,
            accept: 'image/*,*/*',
          },
        );
        return buildLogoBufferResponse(response.body, response.headers);
      } catch (proxyError) {
        console.warn('代理 logo 环境代理回源失败:', proxyError);
      }
    }

    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 403 });
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

async function buildLogoResponse(imageResponse: Response) {
  if (!imageResponse.ok) {
    return NextResponse.json(
      { error: imageResponse.statusText },
      { status: imageResponse.status },
    );
  }

  const imageData = await readArrayBufferLimited(imageResponse, MAX_LOGO_BYTES);
  return buildLogoBufferResponse(imageData, imageResponse.headers);
}

function buildLogoBufferResponse(
  imageData: ArrayBuffer | Buffer,
  sourceHeaders: Headers,
) {
  const contentType = sourceHeaders.get('content-type');
  if (!contentType?.toLowerCase().startsWith('image/')) {
    return NextResponse.json(
      { error: 'Invalid image response' },
      { status: 415 },
    );
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');

  return new Response(bufferToArrayBuffer(imageData), {
    status: 200,
    headers,
  });
}

function bufferToArrayBuffer(buffer: ArrayBuffer | Buffer): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) {
    return buffer;
  }
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}
