/** @jest-environment node */
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';

import { getAdminAlerts, getSubscriptionAlerts } from './admin-alerts.server';

jest.mock('@/lib/config', () => ({ getConfigForRead: jest.fn() }));
jest.mock('@/lib/db', () => ({
  db: {
    getSourceHealthSearchDaily: jest.fn(),
    getSourcePlayReporterSummary: jest.fn(),
    getReviewReportPage: jest.fn(),
    getConfigSubscription: jest.fn(),
  },
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
