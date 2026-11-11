import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { isServerRelayPaused } from '@/lib/host-traffic.server';
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
      (
        await getAvailableApiSites(
          guardResult.username,
          config,
          guardResult.userAccess,
        )
      ).map((source) => source.key),
    );
    // 中转暂停时自动源不再回落服务器；仅限中转的源保持原样，由播放失败触发自动换源
    const relayPaused = await isServerRelayPaused();
    const modes: Record<string, SourceProxyMode> = {};
    for (const s of config.SourceConfig) {
      if (!availableSources.has(s.key)) continue;
      const mode = s.proxyMode || DEFAULT_SOURCE_PROXY_MODE;
      modes[s.key] = relayPaused && mode === 'auto' ? 'browser' : mode;
    }
    return NextResponse.json(modes, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.warn('获取代理模式失败:', error);
    return NextResponse.json({}, { status: 200 });
  }
}
