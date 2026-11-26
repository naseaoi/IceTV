/** @jest-environment node */
import { db } from '@/lib/db';
import { createProxyFailureDiagnostic } from '@/lib/proxy-diagnostics';
import {
  flushSourceProxyFailures,
  recordSourceProxyFailure,
  resetSourceProxyFailuresForTests,
} from '@/lib/source-proxy-failures.server';
import { SOURCE_HEALTH_FLUSH_INTERVAL_MS } from '@/lib/source-quality-policy';

jest.mock('@/lib/db', () => ({
  db: { recordSourceProxyFailureBatch: jest.fn() },
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn(async () => ({
    SourceConfig: [
      { key: 'a' },
      { key: 'b' },
      { key: 'fresh' },
      ...Array.from({ length: 4100 }, (_, i) => ({ key: `source-${i}` })),
    ],
  })),
}));

const record = (source = 'a') =>
  recordSourceProxyFailure(
    createProxyFailureDiagnostic({
      route: 'segment',
      source,
      stage: 'upstream',
      reason: 'upstream-http',
      upstreamStatus: 403,
    }),
  );
const write = db.recordSourceProxyFailureBatch as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-01T00:00:00Z'));
  resetSourceProxyFailuresForTests();
  write.mockReset().mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  resetSourceProxyFailuresForTests();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('merges buckets and flushes on a timer without blocking recording', async () => {
  record();
  record();
  record('b');
  expect(write).not.toHaveBeenCalled();
  jest.advanceTimersByTime(SOURCE_HEALTH_FLUSH_INTERVAL_MS);
  await flushSourceProxyFailures();
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith([
    {
      source: 'a',
      bucketDate: '2026-11-01',
      reason: 'http-403',
      failureCount: 2,
    },
    {
      source: 'b',
      bucketDate: '2026-11-01',
      reason: 'http-403',
      failureCount: 1,
    },
  ]);
  await flushSourceProxyFailures();
  expect(write).toHaveBeenCalledTimes(1);
});

it('keeps reasons separate and ignores excluded diagnostics', async () => {
  record();
  recordSourceProxyFailure(
    createProxyFailureDiagnostic({
      route: 'key',
      source: 'a',
      stage: 'upstream',
      reason: 'upstream-timeout',
    }),
  );
  recordSourceProxyFailure(
    createProxyFailureDiagnostic({
      route: 'segment',
      source: 'a',
      stage: 'upstream',
      reason: 'upstream-fetch',
      isLive: true,
    }),
  );
  await flushSourceProxyFailures();
  expect(write.mock.calls[0][0]).toEqual([
    {
      source: 'a',
      bucketDate: '2026-11-01',
      reason: 'http-403',
      failureCount: 1,
    },
    {
      source: 'a',
      bucketDate: '2026-11-01',
      reason: 'timeout',
      failureCount: 1,
    },
  ]);
});

it('coalesces concurrent flushes and merges failed batches with new events', async () => {
  let reject!: (error: Error) => void;
  write.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectWrite) => {
        reject = rejectWrite;
      }),
  );
  record();
  const first = flushSourceProxyFailures();
  expect(flushSourceProxyFailures()).toBe(first);
  // 写入前要先读配置过滤源，等到写入真正发起
  for (let i = 0; i < 5 && !write.mock.calls.length; i++)
    await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(1);
  record();
  reject(new Error('database unavailable'));
  await first;
  jest.advanceTimersByTime(SOURCE_HEALTH_FLUSH_INTERVAL_MS);
  await flushSourceProxyFailures();
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1][0]).toEqual([
    {
      source: 'a',
      bucketDate: '2026-11-01',
      reason: 'http-403',
      failureCount: 2,
    },
  ]);
});

it('caps pending buckets during failure recovery and drops expired events', async () => {
  write.mockRejectedValueOnce(new Error('database unavailable'));
  for (let i = 0; i < 4100; i++) record(`source-${i}`);
  await flushSourceProxyFailures();
  expect(write.mock.calls[0][0]).toHaveLength(4096);
  jest.setSystemTime(new Date('2026-12-10T00:00:00Z'));
  record('fresh');
  await flushSourceProxyFailures();
  expect(write.mock.calls[1][0]).toEqual([
    {
      source: 'fresh',
      bucketDate: '2026-12-10',
      reason: 'http-403',
      failureCount: 1,
    },
  ]);
});

it('drops sources that are not configured', async () => {
  record('a');
  record('forged-key');
  await flushSourceProxyFailures();
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][0]).toEqual([
    expect.objectContaining({ source: 'a' }),
  ]);
  record('forged-key');
  await flushSourceProxyFailures();
  expect(write).toHaveBeenCalledTimes(1);
});
