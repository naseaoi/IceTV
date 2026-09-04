import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const enabled = await db.getDanmakuEnabledPreference(guardResult.username);
    return NextResponse.json({ enabled }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('读取账号弹幕设置失败:', error);
    return NextResponse.json(
      { error: '读取弹幕设置失败' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: '无效的 JSON' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !('enabled' in body) ||
      typeof (body as { enabled?: unknown }).enabled !== 'boolean'
    ) {
      return NextResponse.json(
        { error: 'enabled 必须是布尔值' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const enabled = (body as { enabled: boolean }).enabled;
    await db.setDanmakuEnabledPreference(guardResult.username, enabled);

    return NextResponse.json({ enabled }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('保存账号弹幕设置失败:', error);
    return NextResponse.json(
      { error: '保存弹幕设置失败' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
