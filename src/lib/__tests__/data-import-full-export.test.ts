/** @jest-environment node */

jest.mock('../env.server', () => ({
  getOwnerUsername: () => 'owner',
}));

import { parseImportData } from '../data-import';
import type { StorageUserImportData } from '../types';
import { IMPORT_ADMIN_CONFIG as adminConfig } from './__fixtures__/import-admin-config';

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

  it('keeps metadata refresh timestamps', async () => {
    const importData = createImportData();
    importData.data.userData.owner.playRecords = {
      'source-a+video-1': {
        title: 'Demo',
        source_name: 'Source A',
        cover: '',
        year: '2026',
        index: 1,
        total_episodes: 12,
        play_time: 30,
        total_time: 120,
        save_time: 1000,
        metadata_checked_at: 2000,
      },
    };
    importData.data.userData.owner.favorites = {
      'source-a+video-1': {
        title: 'Demo',
        source_name: 'Source A',
        cover: '',
        year: '2026',
        total_episodes: 12,
        save_time: 1000,
        metadata_checked_at: 2000,
      },
    };

    const parsed = await parseImportData(importData);

    expect(
      parsed.snapshot.userData.owner.playRecords['source-a+video-1']
        .metadata_checked_at,
    ).toBe(2000);
    expect(
      parsed.snapshot.userData.owner.favorites['source-a+video-1']
        .metadata_checked_at,
    ).toBe(2000);
  });

  it('rejects invalid metadata refresh timestamps', async () => {
    const importData = createImportData();
    importData.data.userData.owner.playRecords = {
      'source-a+video-1': {
        title: 'Demo',
        source_name: 'Source A',
        cover: '',
        year: '2026',
        index: 1,
        total_episodes: 12,
        play_time: 30,
        total_time: 120,
        save_time: 1000,
        metadata_checked_at: -1,
      },
    };

    await expect(parseImportData(importData)).rejects.toThrow(
      '元数据检查时间超出限制',
    );
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
