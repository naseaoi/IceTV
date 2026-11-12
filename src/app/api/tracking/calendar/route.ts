import { NextRequest, NextResponse } from 'next/server';

import { getTrackingCalendar } from '@/features/continue-watching/lib/tracking-calendar.server';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    return NextResponse.json(
      { items: await getTrackingCalendar(guard.username) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('追剧周历加载失败', error);
    return NextResponse.json(
      { error: '追剧周历加载失败，请稍后重试' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
