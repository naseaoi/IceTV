import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '当前模式不支持注册账号' },
      { status: 400 },
    );
  }

  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };

    const username = (body.username || '').trim();
    const password = body.password || '';

    if (!username) {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    const ownerUsername = getOwnerUsername();
    if (username === ownerUsername) {
      return NextResponse.json({ error: '该用户名不可注册' }, { status: 400 });
    }

    const config = await getConfig();
    if (!config.UserConfig.OpenRegister) {
      return NextResponse.json({ error: '当前未开放注册' }, { status: 403 });
    }

    const exists = await db.checkUserExist(username);
    if (exists) {
      return NextResponse.json({ error: '用户名已存在' }, { status: 409 });
    }

    await db.registerUser(username, password);

    const alreadyInConfig = config.UserConfig.Users.some(
      (u) => u.username === username,
    );
    if (!alreadyInConfig) {
      config.UserConfig.Users.push({
        username,
        role: 'user',
        banned: false,
      });
      await db.saveAdminConfig(config);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: '注册失败' }, { status: 500 });
  }
}
