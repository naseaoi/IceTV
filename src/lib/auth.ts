import { NextRequest } from 'next/server';

export type AuthRole = 'owner' | 'admin' | 'user';

export type AuthCookiePayload = {
  username?: string;
  signature?: string;
  expiresAt?: number;
  role?: AuthRole;
  sessionType?: 'localstorage' | 'account';
};

export type AuthMetaPayload = {
  username?: string;
  role?: AuthRole;
};

// 从cookie获取认证信息 (服务端使用)
export function getAuthInfoFromCookie(
  request: NextRequest,
): AuthCookiePayload | null {
  const authCookie = request.cookies.get('auth');

  if (!authCookie) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(authCookie.value);
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
      const decodedMeta = decodeURIComponent(authMetaCookie);
      const authMeta = JSON.parse(decodedMeta) as AuthMetaPayload;
      return authMeta;
    }

    const authCookie = cookies['auth'];
    if (!authCookie) {
      return null;
    }

    // 处理可能的双重编码
    let decoded = decodeURIComponent(authCookie);

    // 如果解码后仍然包含 %，说明是双重编码，需要再次解码
    if (decoded.includes('%')) {
      decoded = decodeURIComponent(decoded);
    }

    const authData = JSON.parse(decoded) as AuthCookiePayload;
    return {
      username: authData.username,
      role: authData.role,
    };
  } catch (error) {
    return null;
  }
}
