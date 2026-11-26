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
