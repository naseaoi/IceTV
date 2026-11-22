import { NextRequest, NextResponse } from 'next/server';

import { backupBeforeUpgrade } from '@/features/upgrade/backup.server';
import {
  isUpdaterConfigured,
  requestUpdater,
  UpdaterConflictError,
} from '@/features/upgrade/client.server';
import type { UpdaterStatus, UpgradeResponse } from '@/features/upgrade/types';
import { isGuardFailure, requireOwner } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let backupPath: string | undefined;
let actionInProgress = false;

function result(status: UpdaterStatus): UpgradeResponse {
  return status.capable
    ? { available: true, status, ...(backupPath ? { backupPath } : {}) }
    : { available: false, reason: status.reason };
}

function json(body: UpgradeResponse | { error: string }, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

// 反向代理后容器收到的协议与 Host 可能是内网值，只比较主机名并认可转发头；会话 cookie 为 SameSite=Lax，这里是纵深防护
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const hosts = [
    request.headers.get('x-forwarded-host')?.split(',')[0],
    request.headers.get('host'),
  ]
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean);
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.origin === origin &&
      hosts.includes(parsed.host)
    );
  } catch {
    return false;
  }
}

function audit(actor: string, action: string, outcome: string) {
  console.warn('[upgrade]', { actor, action, result: outcome });
}

export async function GET(request: NextRequest) {
  const guard = await requireOwner(request);
  if (isGuardFailure(guard)) return guard.response;
  if (!isUpdaterConfigured()) {
    audit(guard.username, 'status', 'not-configured');
    return json({ available: false, reason: '当前部署未配置网页升级服务' });
  }
  try {
    const status = await requestUpdater('status');
    audit(
      guard.username,
      'status',
      status.capable ? status.job.phase : 'unavailable',
    );
    return json(result(status));
  } catch {
    audit(guard.username, 'status', 'unreachable');
    return json({ available: false, reason: '升级服务暂时不可用，请稍后重试' });
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireOwner(request);
  if (isGuardFailure(guard)) return guard.response;
  if (!isSameOrigin(request)) {
    audit(guard.username, 'unknown', 'origin-rejected');
    return json({ error: '请求来源校验失败，请刷新页面后重试' }, 403);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    audit(guard.username, 'unknown', 'invalid-json');
    return json({ error: '请求格式错误' }, 400);
  }
  const action =
    body && typeof body === 'object' && 'action' in body
      ? body.action
      : undefined;
  if (action !== 'pull' && action !== 'restart') {
    audit(guard.username, 'unknown', 'invalid-action');
    return json({ error: '无效的升级操作' }, 400);
  }
  if (!isUpdaterConfigured()) {
    audit(guard.username, action, 'not-configured');
    return json({ error: '当前部署未配置网页升级服务' }, 503);
  }
  if (actionInProgress) {
    audit(guard.username, action, 'conflict');
    return json({ error: '升级操作正在处理，请稍后重试' }, 409);
  }
  actionInProgress = true;
  try {
    if (action === 'restart') {
      try {
        backupPath = await backupBeforeUpgrade();
      } catch (error) {
        console.error('[upgrade] SQLite backup failed', error);
        audit(guard.username, action, 'backup-failed');
        return json(
          { error: '数据库备份失败，已取消重启，请检查存储空间与目录权限' },
          500,
        );
      }
    }
    const status = await requestUpdater(action);
    audit(guard.username, action, status.job.phase);
    return json(result(status));
  } catch (error) {
    if (error instanceof UpdaterConflictError) {
      audit(guard.username, action, 'conflict');
      return json({ error: error.message }, 409);
    }
    audit(guard.username, action, 'updater-failed');
    return json({ error: '升级服务暂时不可用，请稍后重试' }, 502);
  } finally {
    actionInProgress = false;
  }
}
