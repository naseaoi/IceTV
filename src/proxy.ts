import { NextRequest, NextResponse } from 'next/server';

import {
  generateSignature,
  getAuthInfoFromCookie,
  getSessionExpiresAt,
  getSignatureData,
  isSecureRequest,
  shouldRefreshSession,
} from '@/lib/auth.server';
import {
  getConfiguredAuthSigningSecret,
  verifyAuthSignature,
} from '@/lib/signing-secret.server';

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

  if (
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
  const isValid = await verifyAuthSignature(signatureData, authInfo.signature, {
    allowLegacyOwnerPassword: true,
  });

  if (!isValid) {
    clearAuthCookies(response, request);
    return response;
  }

  const signingSecret = getConfiguredAuthSigningSecret();
  const nextExpiresAt = getSessionExpiresAt();
  if (
    !signingSecret ||
    !shouldRefreshSession(authInfo.expiresAt, nextExpiresAt)
  ) {
    return response;
  }

  const nextSignature = await generateSignature(
    getSignatureData(authInfo.sessionType, nextExpiresAt, authInfo.username),
    signingSecret,
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
