import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { validateAccountPassword } from '@/lib/password-policy';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { oldPassword, newPassword } = body;

    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    // 验证旧密码
    if (!oldPassword || typeof oldPassword !== 'string') {
      return NextResponse.json({ error: '请输入当前密码' }, { status: 400 });
    }

    // 验证新密码
    if (!newPassword || typeof newPassword !== 'string') {
      return NextResponse.json({ error: '新密码不得为空' }, { status: 400 });
    }

    const passwordError = validateAccountPassword(newPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const username = guardResult.username;

    // 不允许站长修改密码
    if (guardResult.isOwner) {
      return NextResponse.json(
        { error: '站长不能通过此接口修改密码' },
        { status: 403 },
      );
    }

    // 验证旧密码是否正确
    const isOldPasswordValid = await db.verifyUser(username, oldPassword);
    if (!isOldPasswordValid) {
      return NextResponse.json({ error: '当前密码错误' }, { status: 401 });
    }

    // 修改密码
    await db.changePassword(username, newPassword);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('修改密码失败:', error);
    return NextResponse.json(
      {
        error: '修改密码失败',
      },
      { status: 500 },
    );
  }
}
