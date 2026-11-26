import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { getCachedSourceHealthReport } from '@/lib/source-health.server';
import {
  type SourceHealthPublicResponse,
  SOURCE_HEALTH_DEFAULT_DAYS,
  toPublicSourceHealth,
} from '@/lib/source-quality-policy';

export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const guard = await requireActiveUser(request);
  if (isGuardFailure(guard)) return guard.response;

  try {
    const config = await getConfigForRead();
    const [sites, report] = await Promise.all([
      getAvailableApiSites(guard.username, config, guard.userAccess),
      getCachedSourceHealthReport(),
    ]);
    if (report === null) {
      return NextResponse.json(
        { error: '播放源健康数据暂不可用' },
        { status: 503, headers },
      );
    }
    const available = new Set(sites.map(({ key }) => key));
    const response: SourceHealthPublicResponse = {
      days: SOURCE_HEALTH_DEFAULT_DAYS,
      items: Object.fromEntries(
        report.flatMap((item) => {
          if (!available.has(item.source)) return [];
          const publicItem = toPublicSourceHealth(item);
          return publicItem ? [[item.source, publicItem]] : [];
        }),
      ),
    };
    return NextResponse.json(response, { headers });
  } catch (error) {
    console.error('Failed to load public source health', error);
    return NextResponse.json(
      { error: '播放源健康数据暂不可用' },
      { status: 503, headers },
    );
  }
}
