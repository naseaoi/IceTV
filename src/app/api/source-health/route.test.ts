/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites, getConfigForRead } from '@/lib/config';
import { getCachedSourceHealthReport } from '@/lib/source-health.server';
import type { SourceHealthReportItem } from '@/lib/source-quality-policy';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn(),
  getAvailableApiSites: jest.fn(),
}));
jest.mock('@/lib/source-health.server', () => ({
  getCachedSourceHealthReport: jest.fn(),
}));
installWebPolyfills();
const { GET } = require('./route') as typeof import('./route');

const daily = Array.from({ length: 7 }, (_, i) => ({
  date: `2026-11-${String(i + 1).padStart(2, '0')}`,
  status: 'ok' as const,
}));
const item: SourceHealthReportItem = {
  source: 'visible',
  tier: 'good',
  score: 95,
  searchAttempts: 100,
  searchAvailability: 0.95,
  avgSearchLatencyMs: 1000,
  playReporterDays: 20,
  playSuccessRate: 0.9,
  smoothReporterDays: 20,
  smoothAccounts: 5,
  smoothRate: 0.8,
  stallRatio: 0.02,
  stallsPer10Min: 2,
  smoothWatchMs: 12_000_000,
  smoothBreakdown: [],
  lastOkDate: '2026-11-07',
  daily,
};
const userAccess = { role: 'user', banned: false, enabledApis: ['visible'] };
const config = { SourceConfig: [] };

beforeEach(() => {
  jest.resetAllMocks();
  (requireActiveUser as jest.Mock).mockResolvedValue({
    username: 'alice',
    userAccess,
  });
  (getConfigForRead as jest.Mock).mockResolvedValue(config);
  (getAvailableApiSites as jest.Mock).mockResolvedValue([
    { key: 'visible' },
    { key: 'offline' },
    { key: 'low-sample' },
    { key: 'unknown' },
  ]);
  (getCachedSourceHealthReport as jest.Mock).mockResolvedValue([
    item,
    {
      ...item,
      source: 'offline',
      tier: 'offline',
      playReporterDays: 0,
      smoothReporterDays: 0,
      playSuccessRate: null,
    },
    { ...item, source: 'low-sample', playReporterDays: 19 },
    ...['disabled', 'unauthorized', 'nsfw'].map((source) => ({
      ...item,
      source,
    })),
  ]);
});
afterEach(() => jest.restoreAllMocks());

it('projects only available, sufficiently sampled sources with the exact public response', async () => {
  const response = await GET({} as NextRequest);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(getAvailableApiSites).toHaveBeenCalledWith(
    'alice',
    config,
    userAccess,
  );
  expect(await response.json()).toEqual({
    days: 7,
    items: {
      visible: {
        tier: 'good',
        playAvailability: 0.9,
        smoothRate: 0.8,
        searchAvailability: 0.95,
        lastOkDate: '2026-11-07',
        daily,
      },
      offline: {
        tier: 'offline',
        playAvailability: null,
        smoothRate: null,
        searchAvailability: 0.95,
        lastOkDate: '2026-11-07',
        daily,
      },
    },
  });
});

it.each([401, 403])(
  'preserves guard rejection %s before reading business data',
  async (status) => {
    const denied = new Response(null, { status });
    (requireActiveUser as jest.Mock).mockResolvedValue({ response: denied });
    expect(await GET({} as NextRequest)).toBe(denied);
    expect(getCachedSourceHealthReport).not.toHaveBeenCalled();
    expect(getConfigForRead).not.toHaveBeenCalled();
  },
);

it('returns a valid empty report when no sources are eligible', async () => {
  (getAvailableApiSites as jest.Mock).mockResolvedValue([]);
  expect(await (await GET({} as NextRequest)).json()).toEqual({
    days: 7,
    items: {},
  });
});

it.each(['cached-failure', 'thrown-error'])(
  'returns a private generic 503 for %s',
  async (failure) => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    if (failure === 'cached-failure') {
      (getCachedSourceHealthReport as jest.Mock).mockResolvedValue(null);
    } else {
      (getConfigForRead as jest.Mock).mockRejectedValue(
        new Error('private database error'),
      );
    }
    const response = await GET({} as NextRequest);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: '播放源健康数据暂不可用' });
  },
);
