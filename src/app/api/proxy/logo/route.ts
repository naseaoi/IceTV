import { NextRequest, NextResponse } from 'next/server';

import { getConfigForRead } from '@/lib/config';
import { authorizeProxyRequest } from '@/lib/proxy-auth';
import {
  readArrayBufferLimited,
  ResponseSizeLimitError,
} from '@/lib/proxy-response-limits';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import { createSwrCache } from '@/lib/server-cache';
import { resourceLimitResponse } from '@/lib/server-resource-errors';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

export const runtime = 'nodejs';

const MAX_LOGO_BYTES = 10 * 1024 * 1024;
const failedLogos = createSwrCache<boolean>({
  name: 'failed-live-logos',
  maxSize: 512,
  freshMs: 120_000,
  staleMs: 0,
});

function logoFailure(url: string) {
  failedLogos.set(url, true);
  return NextResponse.json(
    { error: '台标暂时无法加载' },
    {
      status: 502,
      headers: { 'Cache-Control': 'private, max-age=120' },
    },
  );
}

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

  if (failedLogos.peek(validation.url)) {
    return NextResponse.json(
      { error: '台标暂时无法加载' },
      {
        status: 502,
        headers: { 'Cache-Control': 'private, max-age=120' },
      },
    );
  }
  const config = await getConfigForRead();
  const runtimeParams = normalizeRuntimeParams(config.SiteConfig);
  const timeoutMs = runtimeParams.ProxyRequestTimeoutSeconds * 1000;
  const liveSource = config.LiveConfig?.find((s: any) => s.key === source);
  const ua = liveSource?.ua || 'AptvPlayer/1.4.10';

  try {
    const imageResponse = await fetchWithUrlGuard(validation.url, {
      useProxyPool: true,
      cache: 'no-cache',
      redirect: 'follow',
      credentials: 'same-origin',
      headers: {
        'User-Agent': ua,
      },
      skipInitialValidation: true,
      timeoutMs,
    });

    const response = await buildLogoResponse(imageResponse);
    if (response.status !== 200) return logoFailure(validation.url);
    failedLogos.invalidate(validation.url);
    return response;
  } catch (error) {
    const busy = resourceLimitResponse(error);
    if (busy) return busy;
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 403 });
    }
    if (error instanceof ResponseSizeLimitError) {
      return NextResponse.json({ error: '台标文件过大' }, { status: 413 });
    }

    console.warn('台标代理回源失败', error);
    return logoFailure(validation.url);
  }
}

async function buildLogoResponse(imageResponse: Response) {
  if (!imageResponse.ok) {
    await imageResponse.body?.cancel().catch(() => {});
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
  headers.set('Cache-Control', 'private, max-age=86400');

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
