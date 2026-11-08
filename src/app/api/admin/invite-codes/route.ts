import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';
import {
  type InviteCodeFilter,
  INVITE_CODE_MAX_PAGE_SIZE,
  INVITE_CODE_PAGE_SIZE,
} from '@/lib/invite-code-storage';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin(request);
    if (isGuardFailure(guard)) return guard.response;
    const params = request.nextUrl.searchParams;
    const filter = params.get('filter') || 'all';
    const limit = params.has('limit')
      ? Number(params.get('limit'))
      : INVITE_CODE_PAGE_SIZE;
    const cursor = params.get('cursor') || undefined;
    if (
      !['all', 'active', 'expired', 'exhausted'].includes(filter) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > INVITE_CODE_MAX_PAGE_SIZE ||
      (cursor && cursor.length > 2048)
    ) {
      return NextResponse.json(
        { error: '邀请码查询参数无效' },
        { status: 400 },
      );
    }
    return NextResponse.json(
      await db.queryInviteCodes({
        filter: filter as InviteCodeFilter,
        limit,
        cursor,
      }),
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message === '邀请码游标无效') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('获取邀请码失败:', error);
    return NextResponse.json({ error: '获取邀请码失败' }, { status: 500 });
  }
}
