import { NextRequest, NextResponse } from 'next/server';

import { isLiveEntryEnabledInConfig } from '@/features/live/lib/live';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import {
  fetchWithUrlGuard,
  UrlValidationError,
  validateProxyUrlForRequest,
} from '@/lib/url-guard';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const config = await getConfigForRead();
  const runtimeParams = normalizeRuntimeParams(config.SiteConfig);
  if (!isLiveEntryEnabledInConfig(config)) {
    return NextResponse.json({ error: '直播未开启' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source =
    searchParams.get('icetv-source') ||
    searchParams.get('moontv-source') ||
    searchParams.get('source');

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  const validation = await validateProxyUrlForRequest(url);
  if (!validation.ok) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 403 });
  }

  const liveSource = config.LiveConfig?.find((s: any) => s.key === source);
  if (!liveSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }
  const ua = liveSource.ua || 'AptvPlayer/1.4.10';

  try {
    const response = await fetchWithUrlGuard(validation.url, {
      cache: 'no-cache',
      redirect: 'follow',
      credentials: 'same-origin',
      headers: {
        'User-Agent': ua,
      },
      skipInitialValidation: true,
      timeoutMs: runtimeParams.LivePrecheckTimeoutSeconds * 1000,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch', message: response.statusText },
        { status: 500 },
      );
    }

    const contentType = response.headers.get('Content-Type');
    if (response.body) {
      response.body.cancel();
    }
    if (contentType?.includes('video/mp4')) {
      return NextResponse.json({ success: true, type: 'mp4' }, { status: 200 });
    }
    if (contentType?.includes('video/x-flv')) {
      return NextResponse.json({ success: true, type: 'flv' }, { status: 200 });
    }
    return NextResponse.json({ success: true, type: 'm3u8' }, { status: 200 });
  } catch (error) {
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 403 });
    }

    return NextResponse.json(
      { error: 'Failed to fetch', message: error },
      { status: 500 },
    );
  }
}
