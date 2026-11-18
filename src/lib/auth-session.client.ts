import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import { AuthSessionRole, ClientAuthSession } from '@/lib/auth-session';
import { isWatchLevel } from '@/lib/watch-level';

export type { ClientAuthSession } from '@/lib/auth-session';

type SessionResponse = {
  authenticated?: boolean;
  level?: unknown;
  username?: string | null;
  role?: AuthSessionRole | null;
  profileId?: string;
  nickname?: string | null;
  avatarSeed?: string | null;
};

function isAuthSessionRole(value: unknown): value is AuthSessionRole {
  return value === 'owner' || value === 'admin' || value === 'user';
}

export async function getClientAuthSession(): Promise<ClientAuthSession> {
  const authInfo = getAuthInfoFromBrowserCookie();
  if (!authInfo?.username) {
    return { status: 'guest' };
  }

  try {
    const response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) {
      return { status: 'error' };
    }

    const session = (await response.json()) as SessionResponse;
    if (
      !session.authenticated ||
      !session.username ||
      !isAuthSessionRole(session.role)
    ) {
      return { status: 'guest' };
    }

    if (
      typeof session.profileId !== 'string' ||
      !session.profileId ||
      (session.nickname !== null && typeof session.nickname !== 'string') ||
      (session.avatarSeed !== null && typeof session.avatarSeed !== 'string') ||
      !isWatchLevel(session.level)
    ) {
      return { status: 'error' };
    }

    return {
      status: 'authenticated',
      username: session.username,
      profileId: session.profileId,
      nickname: session.nickname,
      avatarSeed: session.avatarSeed,
      level: session.level,
      role: session.role,
    };
  } catch {
    return { status: 'error' };
  }
}
