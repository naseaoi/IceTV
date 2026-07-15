import 'server-only';

import { isGuardFailure, requireActiveUserFromAuthInfo } from '@/lib/api-auth';
import { parseAuthCookieValue } from '@/lib/auth.server';
import { ClientAuthSession } from '@/lib/auth-session';

export async function getServerAuthSession(
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

    return { status: 'authenticated', username: result.username };
  } catch (error) {
    console.error('服务端会话恢复失败:', error);
    return { status: 'error' };
  }
}
