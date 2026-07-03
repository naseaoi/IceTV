import { NextResponse } from 'next/server';

import { getConfigForRead } from '@/lib/config';

export const runtime = 'nodejs';

/** 返回源站流量路由映射：{ [sourceKey]: 'server' | 'browser' } */
export async function GET() {
  try {
    const config = await getConfigForRead();
    const modes: Record<string, string> = {};
    for (const s of config.SourceConfig) {
      if (s.proxyMode) {
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
