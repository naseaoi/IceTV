import { NextRequest } from 'next/server';

type AuthRole = 'owner' | 'admin' | 'user';

export type AuthCookiePayload = {
  username?: string;
  signature?: string;
  expiresAt?: number;
  role?: AuthRole;
  sessionType?: 'account';
};

export type AuthMetaPayload = {
  username?: string;
  role?: AuthRole;
};

const SESSION_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_HOURS = 24 * 30;
const PERMANENT_SESSION_EXPIRES_AT = Date.parse('2099-12-31T23:59:59.999Z');

// 从cookie获取认证信息 (服务端使用)
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

// 从cookie获取认证信息 (客户端使用)
export function getAuthInfoFromBrowserCookie(): AuthMetaPayload | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const parseCookieJson = <T>(value: string): T | null => {
      try {
        return JSON.parse(value) as T;
      } catch (_) {
        // continue fallback decoding
      }

      try {
        return JSON.parse(decodeURIComponent(value)) as T;
      } catch (_) {
        // continue fallback decoding
      }

      try {
        return JSON.parse(decodeURIComponent(decodeURIComponent(value))) as T;
      } catch (_) {
        return null;
      }
    };

    // 解析 document.cookie
    const cookies = document.cookie.split(';').reduce(
      (acc, cookie) => {
        const trimmed = cookie.trim();
        const firstEqualIndex = trimmed.indexOf('=');

        if (firstEqualIndex > 0) {
          const key = trimmed.substring(0, firstEqualIndex);
          const value = trimmed.substring(firstEqualIndex + 1);
          if (key && value) {
            acc[key] = value;
          }
        }

        return acc;
      },
      {} as Record<string, string>,
    );

    const authMetaCookie = cookies['auth_meta'];
    if (authMetaCookie) {
      const authMeta = parseCookieJson<AuthMetaPayload>(authMetaCookie);
      if (authMeta) {
        return authMeta;
      }
    }

    const authCookie = cookies['auth'];
    if (!authCookie) {
      return null;
    }

    const authData = parseCookieJson<AuthCookiePayload>(authCookie);
    if (!authData) {
      return null;
    }

    return {
      username: authData.username,
      role: authData.role,
    };
  } catch (error) {
    return null;
  }
}

/**
 * 读取会话过期时间配置。
 * 未配置时默认采用长期登录，只有主动登出才会失效。
 */
export function getSessionExpiresAt(now: number = Date.now()): number {
  const ttlHoursRaw = process.env.AUTH_SESSION_TTL_HOURS;

  if (!ttlHoursRaw || ttlHoursRaw.trim() === '') {
    return now + DEFAULT_SESSION_TTL_HOURS * SESSION_HOUR_MS;
  }

  const ttlHours = Number(ttlHoursRaw);
  if (!Number.isFinite(ttlHours)) {
    return now + DEFAULT_SESSION_TTL_HOURS * SESSION_HOUR_MS;
  }

  if (ttlHours <= 0) {
    return PERMANENT_SESSION_EXPIRES_AT;
  }

  return now + Math.max(1, ttlHours) * SESSION_HOUR_MS;
}

/**
 * 统一生成签名原文，避免登录、校验、续期各处规则不一致。
 */
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

/**
 * 判断当前会话是否需要刷新过期时间。
 * 永久会话只在首次迁移时刷新一次；有限时长会话在临近过期时续期。
 */
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

// CryptoKey 缓存：secret 在应用生命周期内不变，避免每次请求都 importKey
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

/**
 * 使用 HMAC-SHA256 生成签名。
 * 用于登录写入和 proxy 续期写回。
 */
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

/**
 * 使用 HMAC-SHA256 验证签名。
 * 用于 session 校验和 proxy 认证。
 */
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
