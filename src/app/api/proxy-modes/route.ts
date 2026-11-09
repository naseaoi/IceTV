import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import {
  type SourceProxyMode,
  DEFAULT_SOURCE_PROXY_MODE,
} from '@/lib/proxy-modes';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const config = await getConfigForRead();
    const availableSources = new Set(
      (await getAvailableApiSites(guardResult.username, config)).map(
        (source) => source.key,
      ),
    );
    const modes: Record<string, SourceProxyMode> = {};
    for (const s of config.SourceConfig) {
      if (!availableSources.has(s.key)) continue;
      modes[s.key] = s.proxyMode || DEFAULT_SOURCE_PROXY_MODE;
    }
    return NextResponse.json(modes, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.warn('获取代理模式失败:', error);
    return NextResponse.json({}, { status: 200 });
  }
}
