import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await requireActiveUser(request);
    if (isGuardFailure(user)) return user.response;
    return NextResponse.json(await db.getWatchLevel(user.username), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error('读取观影等级失败', error);
    return NextResponse.json(
      { error: '读取观影等级失败' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
