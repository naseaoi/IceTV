import 'server-only';

import { NextRequest } from 'next/server';

export type AuthRole = 'owner' | 'admin' | 'user';

export type AuthCookiePayload = {
  username?: string;
  signature?: string;
  expiresAt?: number;
  role?: AuthRole;
  sessionType?: 'account';
};

const SESSION_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_HOURS = 24 * 30;
const PERMANENT_SESSION_EXPIRES_AT = Date.parse('2099-12-31T23:59:59.999Z');

export function getAuthInfoFromCookie(
  request: NextRequest,
): AuthCookiePayload | null {
  const authCookie = request.cookies.get('auth');

  if (!authCookie) {
    return null;
  }

  return parseAuthCookieValue(authCookie.value);
}

export function parseAuthCookieValue(value: string): AuthCookiePayload | null {
  try {
    const decoded = decodeURIComponent(value);
    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    return null;
  }
}

export function getSessionExpiresAt(now: number = Date.now()): number {
  const ttlHoursRaw = process.env.AUTH_SESSION_TTL_HOURS;

  if (!ttlHoursRaw || ttlHoursRaw.trim() === '') {
    return now + DEFAULT_SESSION_TTL_HOURS * SESSION_HOUR_MS;
  }

  const ttlHours = Number(ttlHoursRaw);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
    console.warn('AUTH_SESSION_TTL_HOURS 无效，使用默认会话时长');
    return now + DEFAULT_SESSION_TTL_HOURS * SESSION_HOUR_MS;
  }

  return now + Math.max(1, ttlHours) * SESSION_HOUR_MS;
}

export function getSignatureData(
  sessionType: AuthCookiePayload['sessionType'],
  expiresAt: number,
  username?: string,
): string {
  if (sessionType !== 'account') {
    throw new Error('账号会话类型无效');
  }

  if (!username) {
    throw new Error('账号会话缺少用户名');
  }

  return `${username}:${expiresAt}`;
}

export function shouldRefreshSession(
  currentExpiresAt: number,
  nextExpiresAt: number,
  now: number = Date.now(),
): boolean {
  if (nextExpiresAt <= currentExpiresAt) {
    return false;
  }

  if (nextExpiresAt >= PERMANENT_SESSION_EXPIRES_AT) {
    return currentExpiresAt < PERMANENT_SESSION_EXPIRES_AT;
  }

  const remainingMs = currentExpiresAt - now;
  const nextTtlMs = nextExpiresAt - now;
  const refreshThresholdMs = Math.min(24 * SESSION_HOUR_MS, nextTtlMs / 3);

  return remainingMs <= refreshThresholdMs;
}

let _cachedSecret: string | null = null;
let _cachedKey: CryptoKey | null = null;
let _cachedSigningSecret: string | null = null;
let _cachedSigningKey: CryptoKey | null = null;

async function getCachedKey(secret: string): Promise<CryptoKey> {
  if (_cachedKey && _cachedSecret === secret) {
    return _cachedKey;
  }
  const keyData = new TextEncoder().encode(secret);
  _cachedKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  _cachedSecret = secret;
  return _cachedKey;
}

async function getCachedSigningKey(secret: string): Promise<CryptoKey> {
  if (_cachedSigningKey && _cachedSigningSecret === secret) {
    return _cachedSigningKey;
  }

  const keyData = new TextEncoder().encode(secret);
  _cachedSigningKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  _cachedSigningSecret = secret;

  return _cachedSigningKey;
}

export async function generateSignature(
  data: string,
  secret: string,
): Promise<string> {
  const messageData = new TextEncoder().encode(data);
  const key = await getCachedSigningKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifySignature(
  data: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const messageData = new TextEncoder().encode(data);

  try {
    const key = await getCachedKey(secret);

    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    );

    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData,
    );
  } catch {
    return false;
  }
}
