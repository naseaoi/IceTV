import { NextRequest, NextResponse } from 'next/server';

import {
  InvalidRuntimeParamsError,
  saveRuntimeParams,
} from '@/features/admin/services/runtimeParams';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { configConflictResponse } from '@/lib/api-config-error';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: '无效的 JSON' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    await saveRuntimeParams(body);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    if (error instanceof InvalidRuntimeParamsError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const conflict = configConflictResponse(error);
    if (conflict) return conflict;
    console.error('更新运行参数失败:', error);
    return NextResponse.json({ error: '更新运行参数失败' }, { status: 500 });
  }
}
