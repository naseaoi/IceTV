/** @jest-environment node */
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import type { HostTrafficStatus } from '@/lib/host-traffic';
import { getHostTrafficStatus } from '@/lib/host-traffic.server';

import {
  getAdminAlerts,
  getSubscriptionAlerts,
  getTrafficAlerts,
} from './admin-alerts.server';

jest.mock('@/lib/config', () => ({ getConfigForRead: jest.fn() }));
jest.mock('@/lib/db', () => ({
  db: {
    getSourceHealthSearchDaily: jest.fn(),
    getSourcePlayReporterSummary: jest.fn(),
    getReviewReportPage: jest.fn(),
    getConfigSubscription: jest.fn(),
  },
}));
jest.mock('@/lib/host-traffic.server', () => ({
  getHostTrafficStatus: jest.fn(),
}));
jest.mock('@/lib/source-health.server', () => ({
  flushSourceHealthSearch: jest.fn(),
}));
const row = (bucketDate: string, errorCount = 5, okCount = 0) => ({
  source: 'one',
  bucketDate,
  errorCount,
  okCount,
  emptyCount: 0,
});
beforeEach(() => {
  jest.clearAllMocks();
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SourceConfig: [{ key: 'one', name: 'One' }],
  });
  (db.getSourceHealthSearchDaily as jest.Mock).mockResolvedValue([
    row('2026-11-09'),
    row('2026-11-10'),
  ]);
  (db.getSourcePlayReporterSummary as jest.Mock).mockResolvedValue([]);
  (db.getReviewReportPage as jest.Mock).mockResolvedValue({
    pendingTotal: 0,
    items: [],
  });
});
it('requires ten failures across two dates and preserves source key', async () => {
  expect(await getAdminAlerts()).toEqual([
    expect.objectContaining({
      key: 'source-offline:one',
      startedAt: Date.parse('2026-11-09T00:00:00Z'),
    }),
  ]);
  (db.getSourceHealthSearchDaily as jest.Mock).mockResolvedValue([
    row('2026-11-10', 99),
  ]);
  expect(await getAdminAlerts()).toEqual([]);
  (db.getSourceHealthSearchDaily as jest.Mock).mockResolvedValue([
    row('2026-11-09', 1),
    row('2026-11-10', 1),
  ]);
  expect(await getAdminAlerts()).toEqual([]);
});
it('clears failure with successful search or play, excludes disabled sources', async () => {
  (db.getSourceHealthSearchDaily as jest.Mock).mockResolvedValue([
    row('2026-11-09'),
    row('2026-11-10', 5, 1),
  ]);
  expect(await getAdminAlerts()).toEqual([]);
  (db.getSourceHealthSearchDaily as jest.Mock).mockResolvedValue([
    row('2026-11-09'),
    row('2026-11-10'),
  ]);
  (db.getSourcePlayReporterSummary as jest.Mock).mockResolvedValue([
    { source: 'one', lastSuccessDate: '2026-11-10' },
  ]);
  expect(await getAdminAlerts()).toEqual([]);
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SourceConfig: [{ key: 'one', disabled: true }],
  });
  expect(await getAdminAlerts()).toEqual([]);
});
it('returns report counts without reporter identities or report content', async () => {
  (db.getSourceHealthSearchDaily as jest.Mock).mockResolvedValue([]);
  (db.getReviewReportPage as jest.Mock).mockResolvedValue({
    pendingTotal: 3,
    items: [{ latestReportedAt: 123, reports: [{ detail: 'private' }] }],
  });
  expect(await getAdminAlerts()).toEqual([
    {
      key: 'pending-reports',
      type: 'pending-reports',
      message: '有 3 项举报待处理',
      startedAt: 123,
      count: 3,
    },
  ]);
});
it('only alerts for enabled subscriptions with recorded failure', async () => {
  (db.getConfigSubscription as jest.Mock).mockResolvedValue({
    ConfigSubscribtion: {
      URL: 'https://secret',
      AutoUpdate: true,
      FailureSince: '2026-11-10T01:00:00Z',
    },
  });
  expect(await getSubscriptionAlerts()).toEqual([
    expect.objectContaining({
      key: 'subscription-failed',
      startedAt: Date.parse('2026-11-10T01:00:00Z'),
    }),
  ]);
  (db.getConfigSubscription as jest.Mock).mockResolvedValue({
    ConfigSubscribtion: {
      URL: 'https://secret',
      AutoUpdate: false,
      FailureSince: '2026-11-10T01:00:00Z',
    },
  });
  expect(await getSubscriptionAlerts()).toEqual([]);
});

describe('getTrafficAlerts', () => {
  const baseStatus: HostTrafficStatus = {
    available: true,
    updatedAt: Date.parse('2026-11-11T00:00:00Z'),
    stale: false,
    cycleStart: '2026-11-01',
    cycleEnd: '2026-12-01',
    rxBytes: 0,
    txBytes: 0,
    usedBytes: 0,
    todayBytes: 0,
    quotaBytes: 1000e9,
    usedRatio: 0.1,
    projectedBytes: 300e9,
    relay: 'active',
  };
  const withStatus = (status: Partial<HostTrafficStatus>) =>
    (getHostTrafficStatus as jest.Mock).mockResolvedValue({
      ...baseStatus,
      ...status,
    });
  beforeEach(() => {
    (getConfigForRead as jest.Mock).mockResolvedValue({
      SourceConfig: [],
      TrafficConfig: { QuotaGB: 1000, ResetDay: 1 },
    });
  });

  it('stays silent without a quota or while usage is on track', async () => {
    withStatus({});
    expect(await getTrafficAlerts()).toEqual([]);
    (getConfigForRead as jest.Mock).mockResolvedValue({ SourceConfig: [] });
    withStatus({ available: false });
    expect(await getTrafficAlerts()).toEqual([]);
  });

  it('keys each alert level by cycle so a new cycle alerts again', async () => {
    withStatus({ relay: 'paused', usedRatio: 0.96, stale: true });
    expect(await getTrafficAlerts()).toEqual([
      expect.objectContaining({ key: 'traffic:stale:2026-11-01' }),
      expect.objectContaining({
        key: 'traffic:paused:2026-11-01',
        message: '流量已用 96%，服务器中转已暂停',
      }),
    ]);
    withStatus({ usedRatio: 0.85 });
    expect(await getTrafficAlerts()).toEqual([
      expect.objectContaining({ key: 'traffic:usage:2026-11-01' }),
    ]);
    withStatus({ projectedBytes: 1200e9 });
    expect(await getTrafficAlerts()).toEqual([
      expect.objectContaining({ key: 'traffic:projected:2026-11-01' }),
    ]);
    withStatus({ available: false });
    expect(await getTrafficAlerts()).toEqual([
      expect.objectContaining({
        key: 'traffic:unavailable:2026-11-01',
        message: '流量统计不可用',
      }),
    ]);
  });
});
