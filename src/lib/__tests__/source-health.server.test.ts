/** @jest-environment node */

import { createHmac } from 'crypto';

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import {
  cleanupSourceHealth,
  flushSourceHealthSearch,
  getCachedSourceHealthReport,
  getSourceHealthReport,
  getSourceHealthTiers,
  recordSourcePlayOutcome,
  recordSourceSearchOutcome,
  recordSourceSmoothness,
  resetSourceHealthSearchForTests,
} from '@/lib/source-health.server';
import {
  SOURCE_HEALTH_FLUSH_INTERVAL_MS,
  SOURCE_HEALTH_TIERS_CACHE_TTL_MS,
} from '@/lib/source-quality-policy';

jest.mock('@/lib/config', () => ({ getConfigForRead: jest.fn() }));
jest.mock('@/lib/signing-secret.server', () => ({
  getAuthSigningSecret: () => 'test-source-health-secret-only',
}));
jest.mock('@/lib/db', () => ({
  db: {
    recordSourceHealthSearchBatch: jest.fn(),
    recordSourcePlayReport: jest.fn(),
    recordSourceSmoothReport: jest.fn(),
    getSourceSmoothReporterDaily: jest.fn(),
    getSourceSmoothBreakdown: jest.fn(),
    getSourceHealthSearchDaily: jest.fn(),
    getSourcePlayReporterSummary: jest.fn(),
    getSourcePlayReporterDaily: jest.fn(),
    purgeSourceHealthBefore: jest.fn(),
  },
}));

installCryptoPolyfill();
const batch = db.recordSourceHealthSearchBatch as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2026-11-04T12:00:00Z'));
  resetSourceHealthSearchForTests();
  (db.getSourcePlayReporterDaily as jest.Mock).mockResolvedValue([]);
  (db.getSourceSmoothReporterDaily as jest.Mock).mockResolvedValue([]);
  (db.getSourceSmoothBreakdown as jest.Mock).mockResolvedValue([]);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('accumulates UTC daily counters and records only successful latency', async () => {
  recordSourceSearchOutcome('a', 'ok', 100);
  recordSourceSearchOutcome('a', 'empty', 200);
  recordSourceSearchOutcome('a', 'error', 999);
  recordSourceSearchOutcome('a', 'ok', 50, Date.parse('2026-11-03T23:59:59Z'));
  recordSourceSearchOutcome('b', 'ok', 10);
  expect(batch).not.toHaveBeenCalled();
  await flushSourceHealthSearch();
  expect(batch).toHaveBeenCalledWith([
    {
      source: 'a',
      bucketDate: '2026-11-04',
      okCount: 1,
      emptyCount: 1,
      errorCount: 1,
      latencyMsSum: 300,
      latencySamples: 2,
    },
    expect.objectContaining({
      source: 'a',
      bucketDate: '2026-11-03',
      okCount: 1,
    }),
    expect.objectContaining({ source: 'b', okCount: 1 }),
  ]);
  await flushSourceHealthSearch();
  expect(batch).toHaveBeenCalledTimes(1);
});

it('flushes opportunistically, deferring storage until after synchronous recording', async () => {
  jest.advanceTimersByTime(SOURCE_HEALTH_FLUSH_INTERVAL_MS);
  expect(batch).not.toHaveBeenCalled();
  expect(recordSourceSearchOutcome('a', 'ok', 100)).toBeUndefined();
  expect(batch).not.toHaveBeenCalled();
  await flushSourceHealthSearch();
  expect(batch).toHaveBeenCalledTimes(1);
});

it('serializes flushes and merges failed increments with newly recorded samples', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  let reject!: (reason: Error) => void;
  batch.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  recordSourceSearchOutcome('a', 'ok', 100);
  const flushing = flushSourceHealthSearch();
  await Promise.resolve();
  recordSourceSearchOutcome('a', 'empty', 200);
  expect(flushSourceHealthSearch()).toBe(flushing);
  reject(new Error('database unavailable'));
  await expect(flushing).resolves.toBeUndefined();
  await flushSourceHealthSearch();
  expect(batch.mock.calls[1][0]).toEqual([
    expect.objectContaining({
      okCount: 1,
      emptyCount: 1,
      latencyMsSum: 300,
      latencySamples: 2,
    }),
  ]);
  expect(warn).toHaveBeenCalledTimes(1);
});

it('drops expired pending buckets while retaining the thirty-day boundary', async () => {
  recordSourceSearchOutcome('expired', 'ok', 1, Date.parse('2026-10-04'));
  recordSourceSearchOutcome('boundary', 'ok', 1, Date.parse('2026-10-05'));
  await flushSourceHealthSearch();
  expect(batch.mock.calls[0][0]).toEqual([
    expect.objectContaining({ source: 'boundary' }),
  ]);

  recordSourceSearchOutcome('aged', 'ok');
  jest.setSystemTime(new Date('2026-12-05T12:00:00Z'));
  await flushSourceHealthSearch();
  expect(batch).toHaveBeenCalledTimes(1);
});

it('bounds repeated failed batches and evicts by date rather than insertion order', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  batch.mockRejectedValue(new Error('database unavailable'));
  recordSourceSearchOutcome('newest', 'ok');
  for (let index = 0; index < 4096; index += 1) {
    recordSourceSearchOutcome(
      `old-${index}`,
      'ok',
      1,
      Date.parse('2026-10-20'),
    );
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await flushSourceHealthSearch();
    const rows = batch.mock.calls[attempt][0];
    expect(rows).toHaveLength(4096);
    expect(rows).toContainEqual(expect.objectContaining({ source: 'newest' }));
    recordSourceSearchOutcome(`recent-${attempt}`, 'ok');
  }
  // Incoming older buckets cannot displace newer buffered buckets.
  recordSourceSearchOutcome('too-old', 'ok', 1, Date.parse('2026-10-10'));
  batch.mockResolvedValue(undefined);
  await flushSourceHealthSearch();
  expect(batch.mock.calls[3][0]).toHaveLength(4096);
  expect(batch.mock.calls[3][0]).not.toContainEqual(
    expect.objectContaining({ source: 'too-old' }),
  );
  await flushSourceHealthSearch();
  expect(batch).toHaveBeenCalledTimes(4);
});

it('discards a failed in-flight batch that aged beyond retention before reinsertion', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  let reject!: (error: Error) => void;
  batch.mockImplementationOnce(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  recordSourceSearchOutcome(
    'expired-in-flight',
    'ok',
    1,
    Date.parse('2026-10-05'),
  );
  const flushing = flushSourceHealthSearch();
  await Promise.resolve();
  jest.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  recordSourceSearchOutcome('current', 'empty', 20);
  reject(new Error('database unavailable'));
  await flushing;
  await flushSourceHealthSearch();
  expect(batch.mock.calls[1][0]).toEqual([
    expect.objectContaining({ source: 'current', emptyCount: 1 }),
  ]);
});

it('isolates synchronous storage failures and invalid timestamps', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  batch.mockImplementationOnce(() => {
    throw new Error('sync failure');
  });
  recordSourceSearchOutcome('a', 'error');
  await expect(flushSourceHealthSearch()).resolves.toBeUndefined();
  expect(() => recordSourceSearchOutcome('a', 'ok', 1, NaN)).not.toThrow();
  await flushSourceHealthSearch();
  expect(batch.mock.calls[1][0][0].errorCount).toBe(1);
});

it('hashes a purpose-separated normalized username without persisting the username', async () => {
  const timestamp = Date.parse('2026-11-04T00:30:00+02:00');
  await recordSourcePlayOutcome(' Alice ', 'a', true, timestamp);
  await recordSourcePlayOutcome('alice', 'a', false, timestamp);
  const reporter = createHmac('sha256', 'test-source-health-secret-only')
    .update('source-health-play:alice')
    .digest('hex')
    .slice(0, 16);
  expect(db.recordSourcePlayReport).toHaveBeenNthCalledWith(1, {
    source: 'a',
    bucketDate: '2026-11-03',
    reporter,
    success: true,
  });
  expect(db.recordSourcePlayReport).toHaveBeenNthCalledWith(2, {
    source: 'a',
    bucketDate: '2026-11-03',
    reporter,
    success: false,
  });
});

it('scores only configured sources over the window and retains older last success dates', async () => {
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SourceConfig: [{ key: 'a', disabled: true }, { key: 'b' }, { key: 'new' }],
  });
  (db.getSourceHealthSearchDaily as jest.Mock).mockResolvedValue([
    {
      source: 'a',
      bucketDate: '2026-10-20',
      okCount: 20,
      emptyCount: 0,
      errorCount: 0,
      latencyMsSum: 2000,
      latencySamples: 20,
    },
    {
      source: 'a',
      bucketDate: '2026-10-29',
      okCount: 0,
      emptyCount: 0,
      errorCount: 10,
      latencyMsSum: 0,
      latencySamples: 0,
    },
    {
      source: 'a',
      bucketDate: '2026-10-30',
      okCount: 0,
      emptyCount: 0,
      errorCount: 5,
      latencyMsSum: 0,
      latencySamples: 0,
    },
    {
      source: 'deleted',
      bucketDate: '2026-11-04',
      okCount: 10,
      emptyCount: 0,
      errorCount: 0,
      latencyMsSum: 100,
      latencySamples: 10,
    },
  ]);
  (db.getSourcePlayReporterSummary as jest.Mock).mockResolvedValueOnce([
    {
      source: 'a',
      successReporterDays: 1,
      failureReporterDays: 0,
      lastSuccessDate: '2026-10-19',
    },
    {
      source: 'b',
      successReporterDays: 1,
      failureReporterDays: 0,
      lastSuccessDate: '2026-10-25',
    },
  ]);
  const items = await getSourceHealthReport(7);
  expect(items).toEqual([
    expect.objectContaining({
      source: 'a',
      tier: 'offline',
      searchAttempts: 15,
      lastOkDate: '2026-10-20',
    }),
    expect.objectContaining({
      source: 'b',
      tier: 'insufficient',
      lastOkDate: '2026-10-25',
    }),
    expect.objectContaining({
      source: 'new',
      tier: 'insufficient',
      lastOkDate: null,
    }),
  ]);
  expect(items[0].daily).toEqual([
    { date: '2026-10-29', status: 'down' },
    { date: '2026-10-30', status: 'down' },
    { date: '2026-10-31', status: 'none' },
    { date: '2026-11-01', status: 'none' },
    { date: '2026-11-02', status: 'none' },
    { date: '2026-11-03', status: 'none' },
    { date: '2026-11-04', status: 'none' },
  ]);
  expect(items[2].daily).toHaveLength(7);
  expect(items[2].daily.every((point) => point.status === 'none')).toBe(true);
  expect(db.getSourceHealthSearchDaily).toHaveBeenCalledWith('2026-10-05');
  expect(db.getSourcePlayReporterDaily).toHaveBeenCalledWith('2026-10-29');
  expect(db.getSourcePlayReporterSummary).toHaveBeenNthCalledWith(
    1,
    '2026-10-05',
  );
});

it('records smooth increments with the same reporter hash and UTC date as outcomes', async () => {
  const payload = {
    source: 'a',
    routeMode: 'server' as const,
    mediaType: 'mp4' as const,
    watchMs: 300_000,
    stallMs: 4000,
    stallCount: 2,
    unknownMs: 1000,
    eventAt: Date.parse('2026-11-04T00:30:00+02:00'),
  };
  await recordSourcePlayOutcome('alice', 'a', true, payload.eventAt);
  await recordSourceSmoothness(' Alice ', payload);
  const { eventAt: _eventAt, ...delta } = payload;
  expect(db.recordSourceSmoothReport).toHaveBeenCalledWith({
    ...delta,
    bucketDate: '2026-11-03',
    reporter: (db.recordSourcePlayReport as jest.Mock).mock.calls[0][0]
      .reporter,
  });
});

it('filters network-limited days for scoring and daily status while retaining diagnostic breakdown', async () => {
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SourceConfig: [{ key: 'a' }],
  });
  (db.getSourceHealthSearchDaily as jest.Mock).mockResolvedValue([]);
  (db.getSourcePlayReporterSummary as jest.Mock).mockResolvedValue([]);
  (db.getSourcePlayReporterDaily as jest.Mock).mockResolvedValue([
    {
      source: 'a',
      bucketDate: '2026-11-04',
      successReporterDays: 20,
      failureReporterDays: 0,
    },
  ]);
  const good = Array.from({ length: 20 }, (_, index) => ({
    source: 'a',
    bucketDate: `2026-11-0${Math.floor(index / 5) + 1}`,
    reporter: `r${index % 5}`,
    watchMs: 600_000,
    stallMs: 0,
    stallCount: 0,
  }));
  const limited = [0, 1, 2].flatMap((account) =>
    ['a', 'b', 'c'].map((source) => ({
      source,
      bucketDate: '2026-11-04',
      reporter: `limited-${account}`,
      watchMs: 600_000,
      stallMs: 60_000,
      stallCount: 3,
    })),
  );
  (db.getSourceSmoothReporterDaily as jest.Mock).mockResolvedValue([
    ...good,
    ...limited,
  ]);
  const breakdown = {
    source: 'a',
    routeMode: 'browser',
    mediaType: 'hls',
    watchMs: 13_800_000,
    stallMs: 180_000,
    stallCount: 9,
    unknownMs: 50_000,
    reporterDays: 23,
  };
  (db.getSourceSmoothBreakdown as jest.Mock).mockResolvedValue([breakdown]);
  const [report] = (await getCachedSourceHealthReport())!;
  expect(report).toMatchObject({
    score: 95,
    smoothReporterDays: 20,
    smoothAccounts: 5,
    smoothRate: 1,
    stallRatio: 0,
    smoothWatchMs: 12_000_000,
    lastOkDate: null,
    smoothBreakdown: [breakdown],
  });
  expect(report.daily[6]).toEqual({ date: '2026-11-04', status: 'ok' });
  expect(db.getSourceSmoothReporterDaily).toHaveBeenCalledWith('2026-10-29');
  expect(db.getSourceSmoothBreakdown).toHaveBeenCalledWith('2026-10-29');
  report.smoothBreakdown[0].watchMs = 0;
  expect(
    (await getCachedSourceHealthReport())![0].smoothBreakdown[0].watchMs,
  ).toBe(13_800_000);
  (db.getSourceSmoothReporterDaily as jest.Mock).mockResolvedValue([
    ...good,
    ...limited.filter((row) => row.source === 'a'),
  ]);
  expect((await getSourceHealthReport(7))[0].daily[6].status).toBe('degraded');
});

it('purges before the UTC date thirty days ago', async () => {
  await cleanupSourceHealth();
  expect(db.purgeSourceHealthBefore).toHaveBeenCalledWith('2026-10-05');
});

describe('getSourceHealthTiers', () => {
  beforeEach(() => {
    (getConfigForRead as jest.Mock).mockResolvedValue({
      SourceConfig: [{ key: 'a' }],
    });
    (db.getSourceHealthSearchDaily as jest.Mock).mockResolvedValue([]);
    (db.getSourcePlayReporterSummary as jest.Mock).mockResolvedValue([]);
  });

  it('coalesces concurrent loads, isolates returned maps and reloads at expiry', async () => {
    const [first, second] = await Promise.all([
      getSourceHealthTiers(),
      getSourceHealthTiers(),
    ]);
    expect(first).toEqual(new Map([['a', 'insufficient']]));
    expect(second).toEqual(first);
    expect(db.getSourceHealthSearchDaily).toHaveBeenCalledTimes(1);
    first.set('a', 'offline');
    expect((await getSourceHealthTiers()).get('a')).toBe('insufficient');
    jest.advanceTimersByTime(SOURCE_HEALTH_TIERS_CACHE_TTL_MS - 1);
    await getSourceHealthTiers();
    expect(db.getSourceHealthSearchDaily).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await getSourceHealthTiers();
    expect(db.getSourceHealthSearchDaily).toHaveBeenCalledTimes(2);
  });

  it('shares full reports with tiers and isolates returned report data', async () => {
    (db.getSourcePlayReporterDaily as jest.Mock).mockResolvedValue([
      {
        source: 'a',
        bucketDate: '2026-11-04',
        successReporterDays: 3,
        failureReporterDays: 0,
      },
    ]);
    const [report, tiers] = await Promise.all([
      getCachedSourceHealthReport(),
      getSourceHealthTiers(),
    ]);
    expect(report![0]).toMatchObject({
      tier: 'normal',
      playReporterDays: 3,
      playSuccessRate: 1,
    });
    expect(report![0].daily[6]).toEqual({ date: '2026-11-04', status: 'ok' });
    expect(tiers.get('a')).toBe('normal');
    expect(db.getSourceHealthSearchDaily).toHaveBeenCalledTimes(1);
    report![0].tier = 'offline';
    report![0].daily[6].status = 'down';
    const cached = await getCachedSourceHealthReport();
    expect(cached![0].tier).toBe('normal');
    expect(cached![0].daily[6].status).toBe('ok');
    await getSourceHealthReport(7);
    expect(db.getSourceHealthSearchDaily).toHaveBeenCalledTimes(2);
  });

  it('falls back to an empty map on read failure and retries after expiry', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    (db.getSourceHealthSearchDaily as jest.Mock).mockRejectedValueOnce(
      new Error('unavailable'),
    );
    const maps = await Promise.all([
      getSourceHealthTiers(),
      getSourceHealthTiers(),
    ]);
    expect(maps).toEqual([new Map(), new Map()]);
    expect(await getCachedSourceHealthReport()).toBeNull();
    expect(await getSourceHealthTiers()).toEqual(new Map());
    expect(db.getSourceHealthSearchDaily).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(SOURCE_HEALTH_TIERS_CACHE_TTL_MS);
    expect(await getSourceHealthTiers()).toEqual(
      new Map([['a', 'insufficient']]),
    );
  });
});
