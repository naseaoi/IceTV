import { NextResponse } from 'next/server';

import { markSourceCors, responseAllowsCors } from '@/lib/source-capability';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

import { getProxySourceKey, resolveProxyUserAgent } from '../utils';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = getProxySourceKey(searchParams);
  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  const validation = await validateProxyUrlForRequest(url);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 403 });
  }

  const ua = await resolveProxyUserAgent(source);

  try {
    const response = await fetchWithUrlGuard(validation.url, {
      headers: {
        'User-Agent': ua,
      },
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
    const keyData = await response.arrayBuffer();
    return new Response(keyData, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Content-Type':
          response.headers.get('Content-Type') || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: error.reason }, { status: 403 });
    }

    return NextResponse.json({ error: 'Failed to fetch key' }, { status: 500 });
  }
}
