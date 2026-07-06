export type AuthRole = 'owner' | 'admin' | 'user';

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

function parseCookieJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {}

  try {
    return JSON.parse(decodeURIComponent(value)) as T;
  } catch {}

  try {
    return JSON.parse(decodeURIComponent(decodeURIComponent(value))) as T;
  } catch {
    return null;
  }
}

export function getAuthInfoFromBrowserCookie(): AuthMetaPayload | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
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
  } catch {
    return null;
  }
}
