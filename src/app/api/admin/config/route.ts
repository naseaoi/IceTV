/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfigResult } from '@/features/admin/types/api';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 },
    );
  }

  try {
    const guardResult = await requireAdmin(request, {
      forbiddenMessage: '你是管理员吗你就访问？',
    });
    if (isGuardFailure(guardResult)) return guardResult.response;

    const config = await getConfig();
    const result: AdminConfigResult = {
      Role: guardResult.isOwner ? 'owner' : 'admin',
      Config: config,
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store', // 管理员配置不缓存
      },
    });
  } catch (error) {
    console.error('获取管理员配置失败:', error);
    return NextResponse.json(
      {
        error: '获取管理员配置失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
