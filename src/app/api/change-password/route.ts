import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { validateAccountPassword } from '@/lib/password-policy';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const hasPassword =
      guard.isOwner || (await db.isPasswordSet(guard.username));
    return NextResponse.json(
      { hasPassword },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('读取密码状态失败:', error);
    return NextResponse.json({ error: '读取密码状态失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    if (guard.isOwner) {
      return NextResponse.json(
        { error: '站长不能通过此接口修改密码' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { oldPassword, newPassword } = body ?? {};
    if (!newPassword || typeof newPassword !== 'string') {
      return NextResponse.json({ error: '新密码不得为空' }, { status: 400 });
    }
    const passwordError = validateAccountPassword(newPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }
    if (oldPassword !== undefined && typeof oldPassword !== 'string') {
      return NextResponse.json({ error: '当前密码格式错误' }, { status: 400 });
    }

    // 密码校验与首次设置状态在存储写入边界复核，防止并发绕过旧密码。
    const changed = await db.changePassword(
      guard.username,
      newPassword,
      false,
      oldPassword || null,
    );
    if (!changed) {
      return NextResponse.json(
        { error: oldPassword ? '当前密码错误' : '请输入当前密码' },
        { status: oldPassword ? 401 : 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('修改密码失败:', error);
    return NextResponse.json({ error: '修改密码失败' }, { status: 500 });
  }
}
