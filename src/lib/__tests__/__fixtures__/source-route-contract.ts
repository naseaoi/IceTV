import type { IStorage } from '@/lib/types';

export async function assertSourceRoutePhases(storage: IStorage) {
  for (const routeMode of ['browser', 'server'] as const) {
    for (const phase of ['primary', 'fallback'] as const) {
      await storage.recordSourceRouteStat({
        source: 'phases',
        routeMode,
        phase,
        success: phase === 'primary',
        eventAt: Date.UTC(2026, 0, 10),
      });
    }
  }
  const rows = await storage.getSourceRouteStats('2026-01-10');
  expect(rows.filter((row) => row.source === 'phases')).toHaveLength(4);
  for (const routeMode of ['browser', 'server'] as const) {
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          source: 'phases',
          routeMode,
          phase: 'primary',
          successCount: 1,
          failureCount: 0,
        },
        {
          source: 'phases',
          routeMode,
          phase: 'fallback',
          successCount: 0,
          failureCount: 1,
        },
      ]),
    );
  }
  expect(
    (await storage.getAllSourceRouteStatBuckets())
      .filter((row) => row.source === 'phases')
      .map((row) => row.routeMode)
      .sort(),
  ).toEqual(['browser-fb-v3', 'browser-v3', 'server-fb-v3', 'server-v3']);
}

export async function assertSourceSmoothness(storage: IStorage) {
  const delta = {
    source: 'smooth-a',
    bucketDate: '2026-01-02',
    reporter: 'r1',
    routeMode: 'browser' as const,
    mediaType: 'hls' as const,
    watchMs: 300_000,
    stallMs: 2000,
    stallCount: 1,
    unknownMs: 500,
  };
  await storage.recordSourceSmoothReport(delta);
  await storage.recordSourceSmoothReport(delta);
  await storage.recordSourceSmoothReport({ ...delta, routeMode: 'server' });
  await storage.recordSourceSmoothReport({ ...delta, mediaType: 'mp4' });
  await storage.recordSourceSmoothReport({ ...delta, reporter: 'r2' });
  await storage.recordSourceSmoothReport({
    ...delta,
    bucketDate: '2026-01-03',
  });
  await storage.recordSourceSmoothReport({ ...delta, source: 'smooth-b' });
  await storage.recordSourceSmoothReport({
    ...delta,
    bucketDate: '2026-01-01',
  });
  const daily = await storage.getSourceSmoothReporterDaily('2026-01-02');
  expect(daily).toEqual([
    {
      source: 'smooth-a',
      bucketDate: '2026-01-02',
      reporter: 'r1',
      watchMs: 1_200_000,
      stallMs: 8000,
      stallCount: 4,
    },
    {
      source: 'smooth-a',
      bucketDate: '2026-01-02',
      reporter: 'r2',
      watchMs: 300_000,
      stallMs: 2000,
      stallCount: 1,
    },
    {
      source: 'smooth-b',
      bucketDate: '2026-01-02',
      reporter: 'r1',
      watchMs: 300_000,
      stallMs: 2000,
      stallCount: 1,
    },
    {
      source: 'smooth-a',
      bucketDate: '2026-01-03',
      reporter: 'r1',
      watchMs: 300_000,
      stallMs: 2000,
      stallCount: 1,
    },
  ]);
  const breakdown = await storage.getSourceSmoothBreakdown('2026-01-02');
  expect(breakdown).toEqual([
    {
      source: 'smooth-a',
      routeMode: 'browser',
      mediaType: 'hls',
      watchMs: 1_200_000,
      stallMs: 8000,
      stallCount: 4,
      unknownMs: 2000,
      reporterDays: 3,
    },
    {
      source: 'smooth-a',
      routeMode: 'browser',
      mediaType: 'mp4',
      watchMs: 300_000,
      stallMs: 2000,
      stallCount: 1,
      unknownMs: 500,
      reporterDays: 1,
    },
    {
      source: 'smooth-a',
      routeMode: 'server',
      mediaType: 'hls',
      watchMs: 300_000,
      stallMs: 2000,
      stallCount: 1,
      unknownMs: 500,
      reporterDays: 1,
    },
    {
      source: 'smooth-b',
      routeMode: 'browser',
      mediaType: 'hls',
      watchMs: 300_000,
      stallMs: 2000,
      stallCount: 1,
      unknownMs: 500,
      reporterDays: 1,
    },
  ]);
  await storage.purgeSourceHealthBefore('2026-01-02');
  expect(await storage.getSourceSmoothReporterDaily('2020-01-01')).toEqual(
    daily,
  );
  expect(await storage.getSourceSmoothBreakdown('2020-01-01')).toEqual(
    breakdown,
  );
  await storage.purgeSourceHealthBefore('2026-01-04');
  expect(await storage.getSourceSmoothReporterDaily('2020-01-01')).toEqual([]);
  expect(await storage.getSourceSmoothBreakdown('2020-01-01')).toEqual([]);
}

export async function assertSourceProxyFailures(storage: IStorage) {
  await storage.recordSourceProxyFailureBatch([]);
  await storage.recordSourceProxyFailureBatch([
    {
      source: 'failure-a',
      bucketDate: '2026-01-01',
      reason: 'http-403',
      failureCount: 99,
    },
    {
      source: 'failure-a',
      bucketDate: '2026-01-02',
      reason: 'http-403',
      failureCount: 2,
    },
    {
      source: 'failure-a',
      bucketDate: '2026-01-03',
      reason: 'http-403',
      failureCount: 3,
    },
    {
      source: 'failure-a',
      bucketDate: '2026-01-02',
      reason: 'timeout',
      failureCount: 1,
    },
    {
      source: 'failure-b',
      bucketDate: '2026-01-02',
      reason: 'connection',
      failureCount: 4,
    },
  ]);
  await storage.recordSourceProxyFailureBatch([
    {
      source: 'failure-a',
      bucketDate: '2026-01-02',
      reason: 'http-403',
      failureCount: 1,
    },
  ]);
  const expected = [
    { source: 'failure-a', reason: 'http-403', failureCount: 6 },
    { source: 'failure-a', reason: 'timeout', failureCount: 1 },
    { source: 'failure-b', reason: 'connection', failureCount: 4 },
  ];
  expect(await storage.getSourceProxyFailures('2026-01-02')).toEqual(expected);
  await storage.purgeSourceProxyFailuresBefore('2026-01-02');
  expect(await storage.getSourceProxyFailures('2020-01-01')).toEqual(expected);
  await storage.purgeSourceProxyFailuresBefore('2026-01-04');
  expect(await storage.getSourceProxyFailures('2020-01-01')).toEqual([]);
}
