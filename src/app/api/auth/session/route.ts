import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie, getSignatureData } from '@/lib/auth.server';
import { getConfig } from '@/lib/config';
import { getOwnerUsername } from '@/lib/env.server';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { verifyAuthSignature } from '@/lib/signing-secret.server';

export const runtime = 'nodejs';

type SessionReason =
  | 'ok'
  | 'missing_cookie'
  | 'session_expired'
  | 'invalid_signature'
  | 'missing_signature'
  | 'missing_username'
  | 'user_not_found'
  | 'user_banned'
  | 'server_error';

function sessionResponse(
  authenticated: boolean,
  reason: SessionReason,
  username?: string,
) {
  return NextResponse.json(
    {
      authenticated,
      reason,
      username: username || null,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: NextRequest) {
  try {
    const ownerUsername = getOwnerUsername();
    const authInfo = getAuthInfoFromCookie(request);

    if (!authInfo) {
      return sessionResponse(false, 'missing_cookie');
    }
    if (!authInfo.username) {
      return sessionResponse(false, 'missing_username');
    }

    if (!authInfo.signature) {
      return sessionResponse(false, 'missing_signature', authInfo.username);
    }

    if (!authInfo.expiresAt || Date.now() > authInfo.expiresAt) {
      return sessionResponse(false, 'session_expired', authInfo.username);
    }

    const isValidSignature = await verifyAuthSignature(
      getSignatureData('account', authInfo.expiresAt, authInfo.username),
      authInfo.signature,
      { allowLegacyOwnerPassword: true },
    );

    if (!isValidSignature) {
      return sessionResponse(false, 'invalid_signature', authInfo.username);
    }

    if (authInfo.username === ownerUsername) {
      return sessionResponse(true, 'ok', authInfo.username);
    }

    const config = await getConfig();
    const user = config.UserConfig.Users.find(
      (u) => u.username === authInfo.username,
    );

    if (!user) {
      return sessionResponse(false, 'user_not_found', authInfo.username);
    }

    if (user.banned) {
      return sessionResponse(false, 'user_banned', authInfo.username);
    }

    return sessionResponse(true, 'ok', authInfo.username);
  } catch (error) {
    console.error('会话检查失败:', error);
    return NextResponse.json(
      {
        authenticated: false,
        reason: 'server_error',
        username: null,
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
