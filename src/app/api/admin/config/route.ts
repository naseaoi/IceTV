import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { getConfigFresh } from '@/lib/config';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import { AdminConfigResult } from '@/types/admin';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request, {
      forbiddenMessage: '你是管理员吗你就访问？',
    });
    if (isGuardFailure(guardResult)) return guardResult.response;

    const config = await getConfigFresh();
    const channelCounts = await db.getLiveSourceChannelCounts();
    const result: AdminConfigResult = {
      Role: guardResult.isOwner ? 'owner' : 'admin',
      Config: {
        ...config,
        ...(await db.getConfigSubscription()),
        LiveConfig: (config.LiveConfig || []).map((source) => ({
          ...source,
          channelNumber: channelCounts[source.key] ?? 0,
        })),
        UserConfig: {
          ...config.UserConfig,
          Users: [],
          TotalUsers: (
            await db.getAdminUserPage({
              ownerUsername: getOwnerUsername() || '',
              operatorUsername: guardResult.username,
              limit: 1,
            })
          ).total,
          inviteCodeCount: await db.countInviteCodes(),
          activeInviteCodeCount: await db.countActiveInviteCodes(),
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
