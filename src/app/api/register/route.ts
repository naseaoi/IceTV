import { NextRequest, NextResponse } from 'next/server';

import {
  findUsableInviteCode,
  INVITE_CODE_UNUSABLE_MESSAGE,
} from '@/features/admin/services/inviteCodes';
import { getClientIp } from '@/lib/client-ip';
import { getConfigForRead, invalidateConfigCache } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import { FixedWindowRateLimiter } from '@/lib/fixed-window-rate-limit';
import {
  releaseInviteCode,
  reserveInviteCode,
} from '@/lib/invite-code-consumption.server';
import { validateAccountPassword } from '@/lib/password-policy';
import {
  isValidUsername,
  normalizeUsername,
  USERNAME_RULE_MESSAGE,
} from '@/lib/username';

export const runtime = 'nodejs';

const MAX_REGISTERS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60_000;

const limiter = new FixedWindowRateLimiter(MAX_REGISTERS_PER_WINDOW, WINDOW_MS);

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
    const verdict = limiter.check(getClientIp(request));
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: '注册过于频繁，请稍后再试' },
        {
          status: 429,
          headers: { 'Retry-After': String(verdict.retryAfterSeconds) },
        },
      );
    }

    const body = (await request.json()) as {
      username?: string;
      password?: string;
      inviteCode?: string;
    };

    const username = normalizeUsername(body.username || '');
    const password = body.password || '';

    if (!username) {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!isValidUsername(username)) {
      return NextResponse.json(
        { error: USERNAME_RULE_MESSAGE },
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

    const config = await getConfigForRead();
    if (!config.UserConfig.OpenRegister) {
      return NextResponse.json({ error: '当前未开放注册' }, { status: 403 });
    }

    if (config.UserConfig.RequireInviteCode) {
      const usable = findUsableInviteCode(
        config.UserConfig.InviteCodes || [],
        body.inviteCode,
      );
      if (!usable) {
        return NextResponse.json(
          { error: INVITE_CODE_UNUSABLE_MESSAGE },
          { status: 403 },
        );
      }
    }

    const exists = await db.checkUserExist(username);
    if (exists) {
      return NextResponse.json({ error: '用户名已存在' }, { status: 409 });
    }

    let reserved = false;
    if (config.UserConfig.RequireInviteCode) {
      reserved = await reserveInviteCode(body.inviteCode);
      if (!reserved) {
        return NextResponse.json(
          { error: INVITE_CODE_UNUSABLE_MESSAGE },
          { status: 403 },
        );
      }
    }

    try {
      await db.registerUser(username, password);
    } catch (error) {
      if (reserved) {
        await releaseInviteCode(body.inviteCode);
      }
      throw error;
    }

    // 用户列表每次加载配置时都从库里重建，这里只需让缓存过期
    invalidateConfigCache();

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isDuplicateUserError(error)) {
      return NextResponse.json({ error: '用户名已存在' }, { status: 409 });
    }

    console.error('注册失败:', error);
    return NextResponse.json({ error: '注册失败' }, { status: 500 });
  }
}
