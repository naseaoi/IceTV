import { NextRequest, NextResponse } from 'next/server';

import { handleAdminUserAction } from '@/features/admin/services/userActions';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';

export const runtime = 'nodejs';

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
