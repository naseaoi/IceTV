import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import {
  type AuthCookiePayload,
  generateSignature,
  getSessionExpiresAt,
  getSignatureData,
} from '@/lib/auth.server';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerPassword, getOwnerUsername } from '@/lib/env.server';
import { verifyPassword } from '@/lib/password';
import { getAuthSigningSecret } from '@/lib/signing-secret.server';
import { normalizeUsername } from '@/lib/username';

export const runtime = 'nodejs';

/**
 * 时序安全的字符串比对，防止通过响应时间差推断密码内容。
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // 长度不同时仍执行一次比对，保持恒定时间
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

type AuthRole = 'owner' | 'admin' | 'user';

type LoginAuthCookiePayload = AuthCookiePayload & {
  role: AuthRole;
  signature: string;
  expiresAt: number;
  sessionType: 'account';
};
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_MAP_MAX_SIZE = 10000;
const DUMMY_PASSWORD_HASH =
  '$2b$10$J4vvp7o4hU/dCA4bL.lkUOp3ln9qAhmtTN81BNVvFa1afAhuOnBA2';

type LoginAttemptState = {
  failCount: number;
  windowStart: number;
  lockedUntil: number;
};

const loginAttempts = new Map<string, LoginAttemptState>();

function getTrustedProxyCount(): number {
  const raw = Number.parseInt(process.env.TRUSTED_PROXY_COUNT || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  const trustedProxyCount = getTrustedProxyCount();

  if (trustedProxyCount > 0 && forwardedFor) {
    const parts = forwardedFor
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const index = parts.length - trustedProxyCount;
    if (index >= 0 && parts[index]) {
      return parts[index];
    }
  }

  const realIp =
    req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  return 'unknown';
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

  // 容量保护：超限时清理过期条目，仍超限则丢弃最旧条目
  if (loginAttempts.size >= LOGIN_MAP_MAX_SIZE) {
    const expiredKeys: string[] = [];
    loginAttempts.forEach((s, k) => {
      if (
        now - s.windowStart > LOGIN_WINDOW_MS &&
        getLockRemainingMs(s, now) <= 0
      ) {
        expiredKeys.push(k);
      }
    });
    expiredKeys.forEach((k) => loginAttempts.delete(k));

    // 仍超限：按插入顺序删除最旧的 10%
    if (loginAttempts.size >= LOGIN_MAP_MAX_SIZE) {
      const toDelete = Math.max(1, Math.floor(loginAttempts.size * 0.1));
      let deleted = 0;
      const keysToRemove: string[] = [];
      loginAttempts.forEach((_, k) => {
        if (deleted < toDelete) {
          keysToRemove.push(k);
          deleted++;
        }
      });
      keysToRemove.forEach((k) => loginAttempts.delete(k));
    }
  }

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
  authData: LoginAuthCookiePayload,
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

// 生成认证Cookie（带签名）
async function generateAuthCookie(
  role: AuthRole,
  username: string,
): Promise<LoginAuthCookiePayload> {
  const expiresAt = getSessionExpiresAt();
  const signatureData = getSignatureData('account', expiresAt, username);
  const signature = await generateSignature(
    signatureData,
    getAuthSigningSecret(),
  );

  return {
    role,
    username,
    signature,
    expiresAt,
    sessionType: 'account',
  };
}

export async function POST(req: NextRequest) {
  try {
    const ownerUsername = getOwnerUsername();
    const ownerPassword = getOwnerPassword();

    const body = (await req.json()) as { username?: string; password?: string };
    const usernameInput =
      typeof body.username === 'string'
        ? normalizeUsername(body.username)
        : undefined;
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

    const rawUsername = body.username;
    const username =
      typeof rawUsername === 'string' ? normalizeUsername(rawUsername) : '';
    const { password } = body;

    if (!username) {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 可能是站长，直接读环境变量
    if (
      typeof rawUsername === 'string' &&
      safeEqual(rawUsername, ownerUsername) &&
      safeEqual(password, ownerPassword)
    ) {
      // 验证成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const authPayload = await generateAuthCookie('owner', rawUsername);
      setAuthCookies(response, req, authPayload);
      clearLoginFailures(rateLimitState.key);

      return response;
    } else if (
      typeof rawUsername === 'string' &&
      safeEqual(rawUsername, ownerUsername)
    ) {
      markLoginFailure(rateLimitState.key);
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    try {
      const userExists = await db.checkUserExist(username);
      const pass = userExists
        ? await db.verifyUser(username, password)
        : (await verifyPassword(password, DUMMY_PASSWORD_HASH)).match;
      if (!pass) {
        markLoginFailure(rateLimitState.key);
        return NextResponse.json(
          { error: '用户名或密码错误' },
          { status: 401 },
        );
      }

      const config = await getConfig();
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (user && user.banned) {
        return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
      }

      // 验证成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const authPayload = await generateAuthCookie(
        user?.role || 'user',
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
