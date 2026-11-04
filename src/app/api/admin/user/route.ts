import { NextRequest, NextResponse } from 'next/server';

import { parseAdminUserQuery } from '@/features/admin/lib/user-query';
import { handleAdminUserAction } from '@/features/admin/services/userActions';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (isGuardFailure(guard)) return guard.response;
  let query;
  try {
    query = parseAdminUserQuery(
      Object.fromEntries(request.nextUrl.searchParams),
    );
  } catch {
    return NextResponse.json({ error: '用户查询参数错误' }, { status: 400 });
  }
  try {
    const page = await db.getAdminUserPage({
      ...query,
      ownerUsername: getOwnerUsername() || '',
      operatorUsername: guard.username,
    });
    return NextResponse.json(page, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof Error && error.message === '用户游标无效')
      return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('获取用户列表失败:', error);
    return NextResponse.json({ error: '获取用户列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request);
    if (isGuardFailure(guardResult)) {
      return guardResult.response;
    }

    const result = await handleAdminUserAction({
      body: await request.json(),
      operatorUsername: guardResult.username,
      operatorRole: guardResult.isOwner ? 'owner' : 'admin',
    });

    return NextResponse.json(result.body, {
      status: result.status,
      headers: result.headers,
    });
  } catch (error) {
    console.error('用户管理操作失败:', error);
    return NextResponse.json({ error: '用户管理操作失败' }, { status: 500 });
  }
}
