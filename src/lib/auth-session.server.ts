import 'server-only';

import { cache } from 'react';

import { isGuardFailure, requireActiveUserFromAuthInfo } from '@/lib/api-auth';
import { parseAuthCookieValue } from '@/lib/auth.server';
import { ClientAuthSession } from '@/lib/auth-session';

const resolveServerAuthSession = cache(async function resolveServerAuthSession(
  authCookieValue?: string,
): Promise<ClientAuthSession> {
  if (!authCookieValue) {
    return { status: 'guest' };
  }

  const authInfo = parseAuthCookieValue(authCookieValue);
  if (!authInfo) {
    return { status: 'guest' };
  }

  try {
    const result = await requireActiveUserFromAuthInfo(authInfo);
    if (isGuardFailure(result)) {
      return { status: 'guest' };
    }

    return {
      status: 'authenticated',
      username: result.username,
      role: result.role,
    };
  } catch (error) {
    console.error('服务端会话恢复失败:', error);
    return { status: 'error' };
  }
});

export function getServerAuthSession(
  authCookieValue?: string,
): Promise<ClientAuthSession> {
  return resolveServerAuthSession(authCookieValue);
}
