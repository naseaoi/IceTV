import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { configConflictResponse } from '@/lib/api-config-error';
import { getConfig, saveConfig } from '@/lib/config';
import { normalizeRuntimeParams } from '@/lib/runtime-params';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const body = (await request.json()) as Record<string, unknown>;
    const runtimeParams = normalizeRuntimeParams(body);
    const adminConfig = await getConfig();

    adminConfig.SiteConfig = {
      ...adminConfig.SiteConfig,
      ...runtimeParams,
    };

    await saveConfig(adminConfig);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    const conflict = configConflictResponse(error);
    if (conflict) return conflict;
    console.error('更新运行参数失败:', error);
    return NextResponse.json({ error: '更新运行参数失败' }, { status: 500 });
  }
}
