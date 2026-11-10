import 'server-only';

import {
  type AdminAlert,
  ADMIN_SOURCE_FAILURE_MIN_ATTEMPTS,
  ADMIN_SOURCE_FAILURE_MIN_DAYS,
} from '@/features/admin/lib/admin-alerts';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { flushSourceHealthSearch } from '@/lib/source-health.server';
import { SOURCE_HEALTH_RETENTION_DAYS } from '@/lib/source-quality-policy';

export async function getAdminAlerts(): Promise<AdminAlert[]> {
  await flushSourceHealthSearch();
  const sinceDate = new Date(
    Date.now() - SOURCE_HEALTH_RETENTION_DAYS * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const [config, search, play, reports] = await Promise.all([
    getConfigForRead(),
    db.getSourceHealthSearchDaily(sinceDate),
    db.getSourcePlayReporterSummary(sinceDate),
    db.getReviewReportPage(),
  ]);
  const alerts: AdminAlert[] = [];
  for (const source of config.SourceConfig) {
    if (source.disabled) continue;
    const rows = search
      .filter((row) => row.source === source.key)
      .sort((a, b) => a.bucketDate.localeCompare(b.bucketDate));
    let lastSuccess =
      play.find((row) => row.source === source.key)?.lastSuccessDate ?? '';
    for (const row of rows) {
      if (row.okCount + row.emptyCount > 0 && row.bucketDate > lastSuccess)
        lastSuccess = row.bucketDate;
    }
    const failures = rows.filter(
      (row) => row.bucketDate > lastSuccess && row.errorCount > 0,
    );
    if (
      failures.length < ADMIN_SOURCE_FAILURE_MIN_DAYS ||
      failures.reduce((sum, row) => sum + row.errorCount, 0) <
        ADMIN_SOURCE_FAILURE_MIN_ATTEMPTS
    )
      continue;
    alerts.push({
      key: `source-offline:${source.key}`,
      type: 'source-offline',
      message: `视频源「${source.name}」持续失效`,
      startedAt: Date.parse(`${failures[0].bucketDate}T00:00:00Z`),
      count: 1,
    });
  }
  if (reports.pendingTotal > 0 && reports.items.length > 0) {
    alerts.push({
      key: 'pending-reports',
      type: 'pending-reports',
      message: `有 ${reports.pendingTotal} 项举报待处理`,
      startedAt: Math.max(
        ...reports.items.map((item) => item.latestReportedAt),
      ),
      count: reports.pendingTotal,
    });
  }
  return alerts;
}

export async function getSubscriptionAlerts(): Promise<AdminAlert[]> {
  const { ConfigSubscribtion: subscription } = await db.getConfigSubscription();
  const startedAt = Date.parse(subscription.FailureSince || '');
  if (
    !subscription.URL ||
    !subscription.AutoUpdate ||
    !Number.isFinite(startedAt)
  )
    return [];
  return [
    {
      key: 'subscription-failed',
      type: 'subscription-failed',
      message: '订阅定时更新失败',
      startedAt,
      count: 1,
    },
  ];
}
