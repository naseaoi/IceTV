import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';

export const runtime = 'nodejs';

type AuthStatusRole = 'owner' | 'admin' | 'user' | null;

type AuthStatusResponse = {
  authenticated: boolean;
  role: AuthStatusRole;
  username?: string;
  code?: string;
};

const noStoreHeaders = {
  'Cache-Control': 'no-store',
};

async function getFailureCode(response: Response): Promise<string> {
  const payload = await response
    .clone()
    .json()
    .catch(() => null);

  if (
    payload &&
    typeof payload === 'object' &&
    'code' in payload &&
    typeof payload.code === 'string'
  ) {
    return payload.code;
  }

  return response.status === 401 ? 'UNAUTHENTICATED' : 'USER_UNAVAILABLE';
}

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);

  if (isGuardFailure(guardResult)) {
    const body: AuthStatusResponse = {
      authenticated: false,
      role: null,
      code: await getFailureCode(guardResult.response),
    };

    return NextResponse.json(body, {
      headers: noStoreHeaders,
    });
  }

  if (guardResult.isOwner) {
    const body: AuthStatusResponse = {
      authenticated: true,
      role: 'owner',
      username: guardResult.username,
    };

    return NextResponse.json(body, {
      headers: noStoreHeaders,
    });
  }

  const config = await getConfigForRead();
  const user = config.UserConfig.Users.find(
    (entry) => entry.username === guardResult.username,
  );
  const body: AuthStatusResponse = {
    authenticated: true,
    role: user?.role || 'user',
    username: guardResult.username,
  };

  return NextResponse.json(body, {
    headers: noStoreHeaders,
  });
}
