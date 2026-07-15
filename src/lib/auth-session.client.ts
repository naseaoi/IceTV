import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import { ClientAuthSession } from '@/lib/auth-session';

export type { ClientAuthSession } from '@/lib/auth-session';

type SessionResponse = {
  authenticated?: boolean;
  username?: string | null;
};

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
    if (!session.authenticated || !session.username) {
      return { status: 'guest' };
    }

    return { status: 'authenticated', username: session.username };
  } catch {
    return { status: 'error' };
  }
}
