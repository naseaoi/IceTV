import { NextRequest, NextResponse } from 'next/server';

import { getConfig, saveConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import { validateAccountPassword } from '@/lib/password-policy';
import { isValidUsername, normalizeUsername } from '@/lib/username';

export const runtime = 'nodejs';

function isDuplicateUserError(error: unknown): boolean {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ER_DUP_ENTRY'
  ) {
    return true;
  }

  return (
    error instanceof Error && /unique|duplicate|constraint/i.test(error.message)
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };

    const username = normalizeUsername(body.username || '');
    const password = body.password || '';

    if (!username) {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!isValidUsername(username)) {
      return NextResponse.json(
        {
          error: '用户名只能包含字母、数字、点、下划线和连字符，长度不超过 64',
        },
        { status: 400 },
      );
    }
    const passwordError = validateAccountPassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const ownerUsername = getOwnerUsername();
    if (username === normalizeUsername(ownerUsername)) {
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
    void saveConfig(config).catch((error) => {
      console.warn('注册用户配置同步失败:', error);
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isDuplicateUserError(error)) {
      return NextResponse.json({ error: '用户名已存在' }, { status: 409 });
    }

    console.error('注册失败:', error);
    return NextResponse.json({ error: '注册失败' }, { status: 500 });
  }
}
