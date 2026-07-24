import { NextRequest, NextResponse } from 'next/server';

import {
  isLiveEntryEnabledInConfig,
  refreshLiveChannelSources,
} from '@/features/live/lib/live';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { configConflictResponse } from '@/lib/api-config-error';
import { getConfig, saveConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const config = await getConfig();

    if (!isLiveEntryEnabledInConfig(config)) {
      return NextResponse.json({
        success: true,
        message: '直播未开启，已跳过刷新',
      });
    }

    await refreshLiveChannelSources(config.LiveConfig || []);

    await saveConfig(config);

    return NextResponse.json({
      success: true,
      message: '直播源刷新成功',
    });
  } catch (error) {
    const conflict = configConflictResponse(error);
    if (conflict) return conflict;
    console.error('直播源刷新失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '刷新失败' },
      { status: 500 },
    );
  }
}
