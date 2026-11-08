import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { DEFAULT_SOURCE_PROXY_MODE } from '@/lib/proxy-modes';
import {
  getSourceRouteCapabilities,
  resolveSourceRoute,
} from '@/lib/source-route-capability.server';

export const runtime = 'nodejs';

// 返回各源实际采用的线路：「自动」源已检测出浏览器无法直连时直接给「代理」，客户端不再先直连失败一轮
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
    const capabilities = await getSourceRouteCapabilities();
    const modes: Record<string, string> = {};
    for (const s of config.SourceConfig) {
      if (!availableSources.has(s.key)) continue;
      const route = resolveSourceRoute(s.proxyMode, capabilities, s.key);
      if (s.proxyMode || route !== DEFAULT_SOURCE_PROXY_MODE) {
        modes[s.key] = route;
      }
    }
    return NextResponse.json(modes, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.warn('获取代理模式失败:', error);
    return NextResponse.json({}, { status: 200 });
  }
}
