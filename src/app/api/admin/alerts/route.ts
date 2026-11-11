import { NextRequest, NextResponse } from 'next/server';

import {
  getAdminAlerts,
  getSubscriptionAlerts,
  getTrafficAlerts,
} from '@/features/admin/lib/admin-alerts.server';
import { requireAdmin, requireOwner } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin(request);
    if ('response' in guard) return guard.response;
    const alerts = await getAdminAlerts();
    if (guard.isOwner) {
      const owner = await requireOwner(request);
      if ('response' in owner) return owner.response;
      const [subscription, traffic] = await Promise.all([
        getSubscriptionAlerts(),
        getTrafficAlerts(),
      ]);
      alerts.push(...subscription, ...traffic);
    }
    return NextResponse.json(
      { alerts },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('读取管理员告警失败:', error);
    return NextResponse.json(
      { error: '管理员提醒暂时无法加载' },
      { status: 500 },
    );
  }
}
