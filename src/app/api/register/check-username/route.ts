import { NextRequest, NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import { FixedWindowRateLimiter } from '@/lib/fixed-window-rate-limit';
import {
  isValidUsername,
  normalizeUsername,
  USERNAME_RULE_MESSAGE,
} from '@/lib/username';

export const runtime = 'nodejs';

const MAX_CHECKS_PER_WINDOW = 30;
const WINDOW_MS = 60_000;

const limiter = new FixedWindowRateLimiter(MAX_CHECKS_PER_WINDOW, WINDOW_MS);

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest) {
  try {
    const verdict = limiter.check(getClientIp(request));
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: '检测过于频繁，请稍后再试' },
        {
          status: 429,
          headers: {
            'Cache-Control': 'no-store',
            'Retry-After': String(verdict.retryAfterSeconds),
          },
        },
      );
    }

    const username = normalizeUsername(
      request.nextUrl.searchParams.get('username') || '',
    );

    if (!username) {
      return jsonResponse({ error: '用户名不能为空' }, 400);
    }
    if (!isValidUsername(username)) {
      return jsonResponse({ error: USERNAME_RULE_MESSAGE }, 400);
    }

    const config = await getConfig();
    if (!config.UserConfig.OpenRegister) {
      return jsonResponse({ error: '当前未开放注册' }, 403);
    }

    if (username === normalizeUsername(getOwnerUsername())) {
      return jsonResponse({ available: false, error: '该用户名不可注册' });
    }

    const exists = await db.checkUserExist(username);

    return jsonResponse(
      exists
        ? { available: false, error: '用户名已被占用' }
        : { available: true },
    );
  } catch (error) {
    console.error('用户名检测失败:', error);
    return jsonResponse({ error: '用户名检测失败' }, 500);
  }
}
