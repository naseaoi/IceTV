import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import {
  type AuthCookiePayload,
  generateSignature,
  getSessionExpiresAt,
  getSignatureData,
  isSecureRequest,
} from '@/lib/auth.server';
import { db } from '@/lib/db';
import { getAuthSigningSecret } from '@/lib/signing-secret.server';
type AuthRole = 'owner' | 'admin' | 'user';

type LoginAuthCookiePayload = AuthCookiePayload & {
  role: AuthRole;
  signature: string;
  expiresAt: number;
  sessionType: 'account';
};
export async function recordLoginActivity(username: string): Promise<void> {
  try {
    await db.recordUserActivity(username, Date.now());
  } catch (err) {
    console.error('记录登录时间失败', err);
  }
}

export function setAuthCookies(
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

export async function generateAuthCookie(
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
