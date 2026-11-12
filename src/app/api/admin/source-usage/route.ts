import { NextRequest, NextResponse } from 'next/server';

import { getPlaybackSourceUsage } from '@/features/playback-stats/lib/source-usage.server';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (isGuardFailure(guard)) return guard.response;
  const rawDays = new URL(request.url).searchParams.get('days') ?? '30';
  if (!['7', '30', '90'].includes(rawDays)) {
    return NextResponse.json(
      { error: '统计天数无效' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const days = Number(rawDays);
  try {
    const [items, config] = await Promise.all([
      getPlaybackSourceUsage(days),
      getConfigForRead(),
    ]);
    const names = new Map(
      config.SourceConfig.map((source) => [source.key, source.name]),
    );
    return NextResponse.json(
      {
        days,
        items: items.map((item) => ({
          ...item,
          sourceName: names.get(item.source) || item.sourceName,
        })),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('获取源使用统计失败', error);
    return NextResponse.json(
      { error: '源使用统计暂不可用' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
