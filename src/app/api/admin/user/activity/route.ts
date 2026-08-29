import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request);
    if (isGuardFailure(guardResult)) {
      return guardResult.response;
    }

    const lastActiveAt = await db.getAllUserLastActive();

    return NextResponse.json(
      { lastActiveAt },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('获取用户活跃时间失败:', error);
    return NextResponse.json(
      { error: '获取用户活跃时间失败' },
      { status: 500 },
    );
  }
}
