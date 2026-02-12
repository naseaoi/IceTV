/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites } from '@/lib/config';

export const runtime = 'nodejs';

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;
  try {
    const apiSites = await getAvailableApiSites(guardResult.username);

    return NextResponse.json(apiSites);
  } catch (error) {
    return NextResponse.json({ error: '获取资源失败' }, { status: 500 });
  }
}
