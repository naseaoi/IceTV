/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getOwnerPassword, getOwnerUsername } from '@/lib/env.server';

export const runtime = 'nodejs';

type SessionReason =
  | 'ok'
  | 'missing_cookie'
  | 'invalid_local_password'
  | 'session_expired'
  | 'invalid_signature'
  | 'missing_signature'
  | 'missing_username'
  | 'user_not_found'
  | 'user_banned'
  | 'no_password_config'
  | 'server_error';

async function verifySignature(
  data: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    );

    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData,
    );
  } catch (error) {
    console.error('会话签名校验失败:', error);
    return false;
  }
}

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
    { status: 200 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    const ownerUsername = getOwnerUsername();
    const ownerPassword = getOwnerPassword();
    const authInfo = getAuthInfoFromCookie(request);

    if (!authInfo) {
      return sessionResponse(false, 'missing_cookie');
    }

    if (storageType === 'localstorage') {
      if (!ownerPassword) {
        return sessionResponse(false, 'no_password_config');
      }
      if (
        authInfo.sessionType !== 'localstorage' ||
        !authInfo.signature ||
        !authInfo.expiresAt
      ) {
        return sessionResponse(false, 'invalid_local_password');
      }

      if (Date.now() > authInfo.expiresAt) {
        return sessionResponse(false, 'session_expired');
      }

      const isValidLocalSignature = await verifySignature(
        `localstorage:${authInfo.expiresAt}`,
        authInfo.signature,
        ownerPassword,
      );
      if (!isValidLocalSignature) {
        return sessionResponse(false, 'invalid_local_password');
      }

      return sessionResponse(true, 'ok', authInfo.username);
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

    const isValidSignature = await verifySignature(
      `${authInfo.username}:${authInfo.expiresAt}`,
      authInfo.signature,
      ownerPassword,
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
      { status: 500 },
    );
  }
}
