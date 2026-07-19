/** @jest-environment node */

import { DEFAULT_RUNTIME_PARAMS } from '@/lib/runtime-params';
import type { AdminConfig } from '@/types/admin';

jest.mock('../env.server', () => ({
  getOwnerUsername: () => 'owner',
}));

import { parseImportData } from '../data-import';
import type { StorageUserImportData } from '../types';

const adminConfig: AdminConfig = {
  ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
  ConfigFile: '',
  SiteConfig: {
    SiteName: 'IceTV',
    SiteIcon: '',
    Announcement: '',
    FooterText: '',
    EnableLiveEntry: false,
    DefaultAggregateSearch: true,
    EnableOptimization: true,
    LiveDirectConnect: false,
    ...DEFAULT_RUNTIME_PARAMS,
    SearchDownstreamMaxPage: 5,
    SiteInterfaceCacheTime: 300,
    DoubanProxyType: 'direct',
    DoubanProxy: '',
    BangumiDataSource: 'server',
    BangumiProxy: '',
    DoubanImageProxyType: 'direct',
    DoubanImageProxy: '',
    DisableYellowFilter: false,
    FluidSearch: true,
  },
  UserConfig: {
    Users: [],
    OpenRegister: false,
    Tags: [],
  },
  SourceConfig: [],
  CustomCategories: [],
  LiveConfig: [],
};

const exportedHash =
  '$2b$10$abcdefghijklmnopqrstuu9dBwFh6R0D4A5gHfHnM6kQ7xS8tT9u';

function emptyUserData(): StorageUserImportData {
  return {
    playRecords: {},
    favorites: {},
    searchHistory: [],
    skipConfigs: {},
    playbackSessions: {},
  };
}

function createImportData() {
  return {
    timestamp: '2026-07-19T00:00:00.000Z',
    serverVersion: '0.4.7',
    data: {
      adminConfig,
      users: {
        'demo-user': exportedHash,
        owner: exportedHash,
      } as Record<string, string> | undefined,
      sourceRouteStats: [
        {
          source: 'source-a',
          routeMode: 'browser',
          bucketDate: '2026-01-08',
          successCount: 3,
          failureCount: 1,
        },
        {
          source: 'source-a',
          routeMode: 'server',
          bucketDate: '2026-01-08',
          successCount: 2,
          failureCount: 0,
        },
      ] as unknown[] | undefined,
      userData: {
        'demo-user': emptyUserData(),
        'legacy-user': emptyUserData(),
        owner: emptyUserData(),
      },
    },
  };
}

describe('data import full export fields', () => {
  it('restores exported password hashes and skips the owner', async () => {
    const parsed = await parseImportData(createImportData());

    expect(parsed.snapshot.users['demo-user']).toBe(exportedHash);
    expect(parsed.snapshot.users.owner).toBeUndefined();
  });

  it('falls back to a random password for users missing from the backup', async () => {
    const parsed = await parseImportData(createImportData());
    const fallback = parsed.snapshot.users['legacy-user'];

    expect(typeof fallback).toBe('string');
    expect(fallback).not.toBe('');
    expect(fallback).not.toBe(exportedHash);
  });

  it('keeps source route stat buckets', async () => {
    const parsed = await parseImportData(createImportData());

    expect(parsed.snapshot.sourceRouteStats).toEqual([
      {
        source: 'source-a',
        routeMode: 'browser',
        bucketDate: '2026-01-08',
        successCount: 3,
        failureCount: 1,
      },
      {
        source: 'source-a',
        routeMode: 'server',
        bucketDate: '2026-01-08',
        successCount: 2,
        failureCount: 0,
      },
    ]);
  });

  it('accepts legacy backups without users and route stats', async () => {
    const importData = createImportData();
    delete importData.data.users;
    delete importData.data.sourceRouteStats;

    const parsed = await parseImportData(importData);

    expect(typeof parsed.snapshot.users['demo-user']).toBe('string');
    expect(parsed.snapshot.sourceRouteStats).toEqual([]);
  });

  it('rejects invalid route stat modes', async () => {
    const importData = createImportData();
    importData.data.sourceRouteStats = [
      {
        source: 'source-a',
        routeMode: 'bogus',
        bucketDate: '2026-01-08',
        successCount: 1,
        failureCount: 0,
      },
    ];

    await expect(parseImportData(importData)).rejects.toThrow(
      '源站路由统计模式格式无效',
    );
  });

  it('rejects invalid route stat dates', async () => {
    const importData = createImportData();
    importData.data.sourceRouteStats = [
      {
        source: 'source-a',
        routeMode: 'browser',
        bucketDate: '20260108',
        successCount: 1,
        failureCount: 0,
      },
    ];

    await expect(parseImportData(importData)).rejects.toThrow(
      '源站路由统计日期格式无效',
    );
  });

  it('rejects duplicate route stat rows', async () => {
    const importData = createImportData();
    const row = {
      source: 'source-a',
      routeMode: 'browser',
      bucketDate: '2026-01-08',
      successCount: 1,
      failureCount: 0,
    };
    importData.data.sourceRouteStats = [row, { ...row }];

    await expect(parseImportData(importData)).rejects.toThrow(
      '源站路由统计条目重复',
    );
  });
});
