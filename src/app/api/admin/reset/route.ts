import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireOwner } from '@/lib/api-auth';
import { resetConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guardResult = await requireOwner(request, {
    forbiddenMessage: '仅支持站长重置配置',
  });
  if (isGuardFailure(guardResult)) return guardResult.response;

  try {
    await resetConfig();

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 管理员配置不缓存
        },
      },
    );
  } catch {
    return NextResponse.json({ error: '重置管理员配置失败' }, { status: 500 });
  }
}
