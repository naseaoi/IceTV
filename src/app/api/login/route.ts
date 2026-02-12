/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerPassword, getOwnerUsername } from '@/lib/env.server';

export const runtime = 'nodejs';

type AuthRole = 'owner' | 'admin' | 'user';

type AuthCookiePayload = {
  role: AuthRole;
  username?: string;
  signature: string;
  expiresAt: number;
  sessionType: 'localstorage' | 'account';
};

const SESSION_TTL_HOURS = Number(process.env.AUTH_SESSION_TTL_HOURS || '168');
const SESSION_TTL_MS = Math.max(1, SESSION_TTL_HOURS) * 60 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

type LoginAttemptState = {
  failCount: number;
  windowStart: number;
  lockedUntil: number;
};

const loginAttempts = new Map<string, LoginAttemptState>();

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

function getAttemptKey(req: NextRequest, username?: string): string {
  return `${getClientIp(req)}:${username || 'anonymous'}`;
}

function getLockRemainingMs(state: LoginAttemptState, now: number): number {
  return Math.max(0, state.lockedUntil - now);
}

function getRateLimitState(
  req: NextRequest,
  username?: string,
): {
  blocked: boolean;
  retryAfterSec?: number;
  key: string;
} {
  const now = Date.now();
  const key = getAttemptKey(req, username);
  const state = loginAttempts.get(key);

  if (!state) {
    return { blocked: false, key };
  }

  if (getLockRemainingMs(state, now) > 0) {
    return {
      blocked: true,
      retryAfterSec: Math.ceil(getLockRemainingMs(state, now) / 1000),
      key,
    };
  }

  if (now - state.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return { blocked: false, key };
  }

  return { blocked: false, key };
}

function markLoginFailure(key: string): void {
  const now = Date.now();
  const state = loginAttempts.get(key);
  if (!state || now - state.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, {
      failCount: 1,
      windowStart: now,
      lockedUntil: 0,
    });
    return;
  }

  state.failCount += 1;
  if (state.failCount >= LOGIN_MAX_ATTEMPTS) {
    state.lockedUntil = now + LOGIN_LOCK_MS;
  }
  loginAttempts.set(key, state);
}

function clearLoginFailures(key: string): void {
  loginAttempts.delete(key);
}

function isSecureRequest(req: NextRequest): boolean {
  return (
    req.nextUrl.protocol === 'https:' ||
    req.headers.get('x-forwarded-proto') === 'https'
  );
}

function setAuthCookies(
  response: NextResponse,
  req: NextRequest,
  authData: AuthCookiePayload,
): void {
  const expires = new Date(authData.expiresAt);
  const secure = isSecureRequest(req);

  response.cookies.set('auth', encodeURIComponent(JSON.stringify(authData)), {
    path: '/',
    expires,
    sameSite: 'lax',
    httpOnly: true,
    secure,
  });

  response.cookies.set(
    'auth_meta',
    encodeURIComponent(
      JSON.stringify({
        username: authData.username,
        role: authData.role,
      }),
    ),
    {
      path: '/',
      expires,
      sameSite: 'lax',
      httpOnly: false,
      secure,
    },
  );
}

function clearAuthCookies(response: NextResponse, req: NextRequest): void {
  const secure = isSecureRequest(req);
  const clearOptions = {
    path: '/',
    expires: new Date(0),
    sameSite: 'lax' as const,
    secure,
  };

  response.cookies.set('auth', '', {
    ...clearOptions,
    httpOnly: true,
  });
  response.cookies.set('auth_meta', '', {
    ...clearOptions,
    httpOnly: false,
  });
}

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'localdb'
    | undefined) || 'localstorage';

// 生成签名
async function generateSignature(
  data: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  // 导入密钥
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // 生成签名
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // 转换为十六进制字符串
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 生成认证Cookie（带签名）
async function generateAuthCookie(
  role: AuthRole,
  sessionType: 'localstorage' | 'account',
  username?: string,
): Promise<AuthCookiePayload> {
  const ownerPassword = getOwnerPassword();
  if (!ownerPassword) {
    throw new Error('站长密码未配置，无法生成会话签名');
  }

  const expiresAt = Date.now() + SESSION_TTL_MS;
  if (sessionType === 'account' && !username) {
    throw new Error('账号会话缺少用户名');
  }
  const signatureData =
    sessionType === 'localstorage'
      ? `localstorage:${expiresAt}`
      : `${username}:${expiresAt}`;
  const signature = await generateSignature(signatureData, ownerPassword);

  return {
    role,
    username,
    signature,
    expiresAt,
    sessionType,
  };
}

export async function POST(req: NextRequest) {
  try {
    const ownerUsername = getOwnerUsername();
    const ownerPassword = getOwnerPassword();

    const body = (await req.json()) as { username?: string; password?: string };
    const usernameInput =
      typeof body.username === 'string' ? body.username : undefined;
    const rateLimitState = getRateLimitState(req, usernameInput);
    if (rateLimitState.blocked) {
      return NextResponse.json(
        {
          ok: false,
          error: `尝试次数过多，请在 ${rateLimitState.retryAfterSec} 秒后重试`,
          retryAfter: rateLimitState.retryAfterSec,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitState.retryAfterSec || 60),
          },
        },
      );
    }

    // 本地 / localStorage 模式——仅校验固定密码
    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = ownerPassword;

      // 未配置 PASSWORD 时直接放行
      if (!envPassword) {
        const response = NextResponse.json({ ok: true });
        clearAuthCookies(response, req);

        return response;
      }

      const { password } = body;
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
      }

      if (password !== envPassword) {
        markLoginFailure(rateLimitState.key);
        return NextResponse.json(
          { ok: false, error: '密码错误' },
          { status: 401 },
        );
      }

      // 验证成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const authPayload = await generateAuthCookie('user', 'localstorage');
      setAuthCookies(response, req, authPayload);
      clearLoginFailures(rateLimitState.key);

      return response;
    }

    // 数据库 / redis 模式——校验用户名并尝试连接数据库
    const { username, password } = body;

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 可能是站长，直接读环境变量
    if (username === ownerUsername && password === ownerPassword) {
      // 验证成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const authPayload = await generateAuthCookie(
        'owner',
        'account',
        username,
      );
      setAuthCookies(response, req, authPayload);
      clearLoginFailures(rateLimitState.key);

      return response;
    } else if (username === ownerUsername) {
      markLoginFailure(rateLimitState.key);
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const config = await getConfig();
    const user = config.UserConfig.Users.find((u) => u.username === username);
    if (user && user.banned) {
      return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
    }

    // 校验用户密码
    try {
      const pass = await db.verifyUser(username, password);
      if (!pass) {
        markLoginFailure(rateLimitState.key);
        return NextResponse.json(
          { error: '用户名或密码错误' },
          { status: 401 },
        );
      }

      // 验证成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const authPayload = await generateAuthCookie(
        user?.role || 'user',
        'account',
        username,
      );
      setAuthCookies(response, req, authPayload);
      clearLoginFailures(rateLimitState.key);

      return response;
    } catch (err) {
      console.error('数据库验证失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('登录接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
