import { NextRequest, NextResponse } from 'next/server';

import {
  generateSignature,
  getAuthInfoFromCookie,
  getSessionExpiresAt,
  getSignatureData,
  shouldRefreshSession,
  verifySignature,
} from '@/lib/auth.server';
import { getOwnerPassword } from '@/lib/env.server';

function isSecureRequest(request: NextRequest): boolean {
  return (
    request.nextUrl.protocol === 'https:' ||
    request.headers.get('x-forwarded-proto') === 'https'
  );
}

function clearAuthCookies(response: NextResponse, request: NextRequest): void {
  const secure = isSecureRequest(request);
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

function setAuthCookies(
  response: NextResponse,
  request: NextRequest,
  authData: {
    role?: 'owner' | 'admin' | 'user';
    username?: string;
    signature: string;
    expiresAt: number;
    sessionType: 'account';
  },
): void {
  const expires = new Date(authData.expiresAt);
  const secure = isSecureRequest(request);

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

export async function proxy(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    if (request.cookies.has('auth_meta')) {
      const response = NextResponse.next();
      clearAuthCookies(response, request);
      return response;
    }

    return NextResponse.next();
  }

  const response = NextResponse.next();
  const ownerPassword = getOwnerPassword();

  if (
    !ownerPassword ||
    !authInfo.signature ||
    !authInfo.expiresAt ||
    authInfo.sessionType !== 'account' ||
    !authInfo.username ||
    Date.now() > authInfo.expiresAt
  ) {
    clearAuthCookies(response, request);
    return response;
  }

  const signatureData = getSignatureData(
    authInfo.sessionType,
    authInfo.expiresAt,
    authInfo.username,
  );
  const isValid = await verifySignature(
    signatureData,
    authInfo.signature,
    ownerPassword,
  );

  if (!isValid) {
    clearAuthCookies(response, request);
    return response;
  }

  const nextExpiresAt = getSessionExpiresAt();
  if (!shouldRefreshSession(authInfo.expiresAt, nextExpiresAt)) {
    return response;
  }

  const nextSignature = await generateSignature(
    getSignatureData(authInfo.sessionType, nextExpiresAt, authInfo.username),
    ownerPassword,
  );

  setAuthCookies(response, request, {
    ...authInfo,
    signature: nextSignature,
    expiresAt: nextExpiresAt,
    sessionType: authInfo.sessionType,
  });

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.[^/]+$).*)',
  ],
};
