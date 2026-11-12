import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireOwner } from '@/lib/api-auth';
import { configConflictResponse } from '@/lib/api-config-error';
import {
  getConfig,
  getConfigFresh,
  invalidateConfigCache,
  saveConfig,
} from '@/lib/config';
import {
  normalizeTrafficSettings,
  TRAFFIC_QUOTA_GB_MAX,
  TRAFFIC_RESET_DAY_MAX,
} from '@/lib/host-traffic';
import {
  getHostTrafficStatus,
  resetHostTrafficCache,
} from '@/lib/host-traffic.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

async function buildPayload() {
  const config = await getConfigFresh();
  const settings = normalizeTrafficSettings(config.TrafficConfig);
  return {
    settings: { QuotaGB: settings.QuotaGB, ResetDay: settings.ResetDay },
    status: await getHostTrafficStatus(config),
  };
}

function failure(error: unknown, action: string) {
  const conflict = configConflictResponse(error);
  if (conflict) return conflict;
  console.error(`${action}失败:`, error);
  return NextResponse.json({ error: `${action}失败` }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const guard = await requireOwner(request);
    if (isGuardFailure(guard)) return guard.response;
    resetHostTrafficCache();
    return NextResponse.json(await buildPayload(), { headers: NO_STORE });
  } catch (error) {
    return failure(error, '读取流量统计');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const guard = await requireOwner(request);
    if (isGuardFailure(guard)) return guard.response;
    const body = (await request.json().catch(() => null)) as {
      QuotaGB?: unknown;
      ResetDay?: unknown;
    } | null;
    const quota = body?.QuotaGB;
    const resetDay = body?.ResetDay;
    if (
      typeof quota !== 'number' ||
      !Number.isInteger(quota) ||
      quota < 0 ||
      quota > TRAFFIC_QUOTA_GB_MAX
    ) {
      return NextResponse.json({ error: '流量额度无效' }, { status: 400 });
    }
    if (
      typeof resetDay !== 'number' ||
      !Number.isInteger(resetDay) ||
      resetDay < 1 ||
      resetDay > TRAFFIC_RESET_DAY_MAX
    ) {
      return NextResponse.json({ error: '重置日无效' }, { status: 400 });
    }

    invalidateConfigCache();
    const config = await getConfig();
    const current = normalizeTrafficSettings(config.TrafficConfig);
    config.TrafficConfig = {
      ...current,
      QuotaGB: quota,
      ResetDay: resetDay,
    };
    await saveConfig(config);
    return NextResponse.json(await buildPayload(), { headers: NO_STORE });
  } catch (error) {
    return failure(error, '保存流量设置');
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireOwner(request);
    if (isGuardFailure(guard)) return guard.response;
    const body = (await request.json().catch(() => null)) as {
      relay?: unknown;
    } | null;
    if (body?.relay !== 'resume' && body?.relay !== 'auto') {
      return NextResponse.json({ error: '操作无效' }, { status: 400 });
    }

    invalidateConfigCache();
    const config = await getConfig();
    const settings = normalizeTrafficSettings(config.TrafficConfig);
    if (body.relay === 'resume') {
      const status = await getHostTrafficStatus(config);
      settings.RelayResumedCycle = status.cycleStart;
    } else {
      delete settings.RelayResumedCycle;
    }
    config.TrafficConfig = settings;
    await saveConfig(config);
    return NextResponse.json(await buildPayload(), { headers: NO_STORE });
  } catch (error) {
    return failure(error, '更新中转状态');
  }
}
