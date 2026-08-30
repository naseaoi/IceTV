import { NextRequest, NextResponse } from 'next/server';

import { mergeInviteCodeUsage } from '@/features/admin/services/inviteCodes';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { getConfigFresh } from '@/lib/config';
import { db } from '@/lib/db';
import { AdminConfigResult } from '@/types/admin';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request, {
      forbiddenMessage: '你是管理员吗你就访问？',
    });
    if (isGuardFailure(guardResult)) return guardResult.response;

    const config = await getConfigFresh();
    const result: AdminConfigResult = {
      Role: guardResult.isOwner ? 'owner' : 'admin',
      Config: {
        ...config,
        UserConfig: {
          ...config.UserConfig,
          InviteCodes: mergeInviteCodeUsage(
            config.UserConfig.InviteCodes,
            await db.getAllInviteCodeUsage(),
          ),
        },
      },
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store', // 管理员配置不缓存
      },
    });
  } catch (error) {
    console.error('获取管理员配置失败:', error);
    return NextResponse.json({ error: '获取管理员配置失败' }, { status: 500 });
  }
}
