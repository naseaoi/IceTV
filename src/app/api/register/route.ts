import { NextRequest, NextResponse } from 'next/server';

import { getConfig, saveConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
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
    await saveConfig(config);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: '注册失败' }, { status: 500 });
  }
}
