import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';

export const runtime = 'nodejs';

/** 返回源站流量路由映射 */
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
    const modes: Record<string, string> = {};
    for (const s of config.SourceConfig) {
      if (s.proxyMode && availableSources.has(s.key)) {
        modes[s.key] = s.proxyMode;
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
