import { NextRequest, NextResponse } from 'next/server';

import { getOptionalActiveUser } from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';
import { isLiveEntryEnabledInConfig } from '@/features/live/lib/live';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const activeUser = await getOptionalActiveUser(request);
    const config = await getConfigForRead();

    if (!config) {
      return NextResponse.json({ error: '配置未找到' }, { status: 404 });
    }

    if (!isLiveEntryEnabledInConfig(config)) {
      return NextResponse.json({ error: '直播未开启' }, { status: 404 });
    }

    // 过滤出所有非 disabled 的直播源
    const liveSources = (config.LiveConfig || []).filter(
      (source) => !source.disabled,
    );

    return NextResponse.json({
      success: true,
      data: activeUser
        ? liveSources
        : liveSources.map((source) => ({
            key: source.key,
            name: source.name,
            from: source.from,
            channelNumber: source.channelNumber || 0,
            disabled: !!source.disabled,
          })),
    });
  } catch (error) {
    console.error('获取直播源失败:', error);
    return NextResponse.json({ error: '获取直播源失败' }, { status: 500 });
  }
}
