import { NextRequest, NextResponse } from 'next/server';

import {
  isLiveEntryEnabledInConfig,
  refreshLiveChannelSources,
} from '@/features/live/lib/live';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { configConflictResponse } from '@/lib/api-config-error';
import { getConfigForRead } from '@/lib/config';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const config = await getConfigForRead();

    if (!isLiveEntryEnabledInConfig(config)) {
      return NextResponse.json({
        refreshed: 0,
        failed: [],
        liveDisabled: true,
      });
    }

    const result = await refreshLiveChannelSources(config.LiveConfig || []);

    return NextResponse.json(result);
  } catch (error) {
    const conflict = configConflictResponse(error);
    if (conflict) return conflict;
    console.error('直播源刷新失败:', error);
    return NextResponse.json({ error: '刷新失败' }, { status: 500 });
  }
}
