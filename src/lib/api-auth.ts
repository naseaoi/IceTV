import { NextRequest, NextResponse } from 'next/server';

import {
  AuthCookiePayload,
  getAuthInfoFromCookie,
  getSignatureData,
} from './auth.server';
import { getConfigForRead } from './config';
import { getOwnerUsername } from './env.server';
import { verifyAuthSignature } from './signing-secret.server';
import { touchUserActivity } from './user-activity.server';
import { normalizeUsername } from './username';

type RequireActiveUserOptions = {
  unauthorizedMessage?: string;
  unauthorizedStatus?: number;
  notFoundMessage?: string;
  bannedMessage?: string;
  includeUserStateCode?: boolean;
};

type GuardFailure = {
  response: NextResponse;
};

type ActiveUserInfo = {
  username: string;
  isOwner: boolean;
  role: 'owner' | 'admin' | 'user';
};

export type RequireActiveUserResult = ActiveUserInfo | GuardFailure;

type RequireAdminOptions = RequireActiveUserOptions & {
  forbiddenMessage?: string;
  forbiddenStatus?: number;
};

export type RequireAdminResult =
  | (ActiveUserInfo & {
      isAdmin: boolean;
    })
  | GuardFailure;

type RequireOwnerOptions = RequireActiveUserOptions & {
  forbiddenMessage?: string;
  forbiddenStatus?: number;
};

export type RequireOwnerResult = ActiveUserInfo | GuardFailure;

export async function requireActiveUser(
  request: NextRequest,
  options: RequireActiveUserOptions = {},
): Promise<RequireActiveUserResult> {
  return requireActiveUserFromAuthInfo(getAuthInfoFromCookie(request), options);
}

export async function requireActiveUserFromAuthInfo(
  authInfo: AuthCookiePayload | null,
  options: RequireActiveUserOptions = {},
): Promise<RequireActiveUserResult> {
  const {
    unauthorizedMessage = 'Unauthorized',
    unauthorizedStatus = 401,
    notFoundMessage = '用户不存在',
    bannedMessage = '用户已被封禁',
    includeUserStateCode = true,
  } = options;

  if (!authInfo || !authInfo.username) {
    return {
      response: NextResponse.json(
        { error: unauthorizedMessage },
        { status: unauthorizedStatus },
      ),
    };
  }

  if (!authInfo.expiresAt || Date.now() > authInfo.expiresAt) {
    return {
      response: NextResponse.json(
        { error: unauthorizedMessage },
        { status: unauthorizedStatus },
      ),
    };
  }

  // 签名验证：防止 cookie 伪造
  if (!authInfo.signature) {
    return {
      response: NextResponse.json(
        { error: unauthorizedMessage },
        { status: unauthorizedStatus },
      ),
    };
  }

  if (authInfo.sessionType !== 'account') {
    return {
      response: NextResponse.json(
        { error: unauthorizedMessage },
        { status: unauthorizedStatus },
      ),
    };
  }

  const signData = getSignatureData(
    authInfo.sessionType,
    authInfo.expiresAt,
    authInfo.username,
  );

  const isValid = await verifyAuthSignature(signData, authInfo.signature, {
    allowLegacyOwnerPassword: true,
  });
  if (!isValid) {
    return {
      response: NextResponse.json(
        { error: unauthorizedMessage },
        { status: unauthorizedStatus },
      ),
    };
  }

  const cookieUsername = authInfo.username;
  const isOwner = cookieUsername === getOwnerUsername();
  if (isOwner) {
    touchUserActivity(normalizeUsername(cookieUsername));
    return {
      username: cookieUsername,
      isOwner,
      role: 'owner',
    };
  }

  const username = normalizeUsername(cookieUsername);
  const config = await getConfigForRead();
  const user = config.UserConfig.Users.find(
    (entry) => entry.username === username,
  );

  if (!user) {
    return {
      response: NextResponse.json(
        includeUserStateCode
          ? { error: notFoundMessage, code: 'USER_NOT_FOUND' }
          : { error: notFoundMessage },
        { status: 403 },
      ),
    };
  }

  if (user.banned) {
    return {
      response: NextResponse.json(
        includeUserStateCode
          ? { error: bannedMessage, code: 'USER_BANNED' }
          : { error: bannedMessage },
        { status: 403 },
      ),
    };
  }

  touchUserActivity(username);

  return {
    username,
    isOwner,
    role: user.role === 'admin' ? 'admin' : 'user',
  };
}

export async function getOptionalActiveUser(
  request: NextRequest,
): Promise<ActiveUserInfo | null> {
  const guardResult = await requireActiveUser(request, {
    unauthorizedMessage: 'Unauthorized',
    includeUserStateCode: false,
  });
  return isGuardFailure(guardResult) ? null : guardResult;
}

export async function requireAdmin(
  request: NextRequest,
  options: RequireAdminOptions = {},
): Promise<RequireAdminResult> {
  const {
    forbiddenMessage = '权限不足',
    forbiddenStatus = 403,
    ...activeUserOptions
  } = options;

  const guardResult = await requireActiveUser(request, activeUserOptions);
  if (isGuardFailure(guardResult)) {
    return guardResult;
  }

  if (guardResult.role === 'owner') {
    return {
      username: guardResult.username,
      isOwner: true,
      isAdmin: true,
      role: 'owner',
    };
  }

  if (guardResult.role !== 'admin') {
    return {
      response: NextResponse.json(
        { error: forbiddenMessage },
        { status: forbiddenStatus },
      ),
    };
  }

  return {
    username: guardResult.username,
    isOwner: false,
    isAdmin: true,
    role: 'admin',
  };
}

export async function requireOwner(
  request: NextRequest,
  options: RequireOwnerOptions = {},
): Promise<RequireOwnerResult> {
  const {
    forbiddenMessage = '权限不足',
    forbiddenStatus = 403,
    ...activeUserOptions
  } = options;

  const guardResult = await requireActiveUser(request, activeUserOptions);
  if (isGuardFailure(guardResult)) {
    return guardResult;
  }

  if (!guardResult.isOwner) {
    return {
      response: NextResponse.json(
        { error: forbiddenMessage },
        { status: forbiddenStatus },
      ),
    };
  }

  return guardResult;
}

export function isGuardFailure(
  result: { response: NextResponse } | object,
): result is { response: NextResponse } {
  return 'response' in result;
}
