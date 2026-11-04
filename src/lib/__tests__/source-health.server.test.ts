/** @jest-environment node */

import { createHmac } from 'crypto';

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import {
  cleanupSourceHealth,
  flushSourceHealthSearch,
  getSourceHealthReport,
  getSourceHealthTiers,
  recordSourcePlayOutcome,
  recordSourceSearchOutcome,
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
    getSourceHealthSearchDaily: jest.fn(),
    getSourcePlayReporterSummary: jest.fn(),
    purgeSourceHealthBefore: jest.fn(),
  },
}));

installCryptoPolyfill();
const batch = db.recordSourceHealthSearchBatch as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2026-11-04T12:00:00Z'));
  resetSourceHealthSearchForTests();
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
  (db.getSourcePlayReporterSummary as jest.Mock)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
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
  expect(db.getSourceHealthSearchDaily).toHaveBeenCalledWith('2026-10-05');
  expect(db.getSourcePlayReporterSummary).toHaveBeenNthCalledWith(
    1,
    '2026-10-29',
  );
  expect(db.getSourcePlayReporterSummary).toHaveBeenNthCalledWith(
    2,
    '2026-10-05',
  );
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
    expect(await getSourceHealthTiers()).toEqual(new Map());
    expect(db.getSourceHealthSearchDaily).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(SOURCE_HEALTH_TIERS_CACHE_TTL_MS);
    expect(await getSourceHealthTiers()).toEqual(
      new Map([['a', 'insufficient']]),
    );
  });
});
