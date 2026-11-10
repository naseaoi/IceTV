/** @jest-environment node */

import {
  assertBatchDeletePlayRecords,
  assertUpdatedPlayRecordPage,
} from '@/lib/__tests__/__fixtures__/play-record-page-contract';
import { assertPlaybackPeriodRange } from '@/lib/__tests__/__fixtures__/playback-period-contract';
import { assertWatchHistoryContract } from '@/lib/__tests__/__fixtures__/watch-history-contract';
import { DEFAULT_RUNTIME_PARAMS } from '@/lib/runtime-params';
import type { AdminConfig } from '@/types/admin';

import { LocalSqliteStorage } from '../sqlite.db';
import type {
  Favorite,
  PlaybackSession,
  PlayRecord,
  SkipConfig,
  SourceRouteStatsItem,
} from '../types';
import { announcementContract } from './__fixtures__/announcement-contract';
import { inviteCodeBatchContract } from './__fixtures__/invite-code-contract';
import { oauthIdentityContract } from './__fixtures__/oauth-identity-contract';
import { userDanmakuContract } from './__fixtures__/user-danmaku-contract';
import { videoReviewContract } from './__fixtures__/video-review-contract';

describe('SQLite 邀请码批量事务契约', () => {
  inviteCodeBatchContract(() => new LocalSqliteStorage(':memory:'));
});

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
    AutoSwitchSource: false,
    EnableDanmaku: false,
    EnableUserDanmaku: false,
    ...DEFAULT_RUNTIME_PARAMS,
    SearchDownstreamMaxPage: 5,
    SiteInterfaceCacheTime: 300,
    DoubanProxyType: 'direct',
    DoubanImageProxyType: 'direct',
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

const playRecord: PlayRecord = {
  title: 'Demo',
  source_name: 'Source',
  cover: '',
  year: '2026',
  index: 1,
  total_episodes: 12,
  play_time: 10,
  total_time: 120,
  save_time: 1000,
  search_title: 'Demo',
};

const favorite: Favorite = {
  title: 'Demo',
  source_name: 'Source',
  cover: '',
  year: '2026',
  total_episodes: 12,
  save_time: 1000,
  search_title: 'Demo',
};

const skipConfig: SkipConfig = {
  enable: true,
  intro_time: 90,
  outro_time: 30,
};

const playbackSession: PlaybackSession = {
  id: 'session_demo_1',
  source: 'source',
  video_id: '1',
  episode_index: 1,
  title: 'Demo',
  source_name: 'Source',
  cover: '',
  year: '2026',
  started_at: 1000,
  ended_at: 2000,
  watch_seconds: 60,
  last_position: 60,
  total_time: 120,
  created_at: 1000,
  updated_at: 2000,
};

function sortRouteStats(items: SourceRouteStatsItem[]) {
  return [...items].sort((a, b) =>
    `${a.source}:${a.routeMode}`.localeCompare(`${b.source}:${b.routeMode}`),
  );
}

describe('sqlite storage contract', () => {
  it('rolls back the complete health search batch on a later row failure', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const row = {
      source: 'alpha',
      bucketDate: '2026-01-02',
      okCount: 1,
      emptyCount: 0,
      errorCount: 0,
      latencyMsSum: 10,
      latencySamples: 1,
    };
    await storage.recordSourceHealthSearchBatch([row]);
    const broken = {
      ...row,
      get source(): string {
        throw new Error('batch failure');
      },
    };
    await expect(
      storage.recordSourceHealthSearchBatch([
        row,
        { ...row, source: 'beta' },
        broken,
      ]),
    ).rejects.toThrow('batch failure');
    expect(await storage.getSourceHealthSearchDaily('2026-01-01')).toEqual([
      row,
    ]);
  });

  it('accumulates health search rows, normalizes counters and retains date boundaries', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const row = {
      source: 'alpha',
      bucketDate: '2026-01-02',
      okCount: 1,
      emptyCount: 2,
      errorCount: 3,
      latencyMsSum: 12.5,
      latencySamples: 3,
    };
    await storage.recordSourceHealthSearchBatch([]);
    await storage.recordSourceHealthSearchBatch([
      { ...row, source: 'zeta', bucketDate: '2026-01-03' },
      { ...row, source: 'beta' },
      { ...row, bucketDate: '2026-01-01' },
      { ...row, source: ' alpha ' },
      row,
      { ...row, source: ' ' },
      {
        ...row,
        source: ' ' + 'x'.repeat(200) + ' ',
        okCount: NaN,
        emptyCount: Infinity,
        errorCount: -1,
        latencyMsSum: -Infinity,
        latencySamples: -3,
      },
    ]);
    await storage.recordSourceHealthSearchBatch([row]);
    expect(await storage.getSourceHealthSearchDaily('2026-01-02')).toEqual([
      {
        ...row,
        okCount: 3,
        emptyCount: 6,
        errorCount: 9,
        latencyMsSum: 37.5,
        latencySamples: 9,
      },
      { ...row, source: 'beta' },
      {
        ...row,
        source: 'x'.repeat(191),
        okCount: 0,
        emptyCount: 0,
        errorCount: 0,
        latencyMsSum: 0,
        latencySamples: 0,
      },
      { ...row, source: 'zeta', bucketDate: '2026-01-03' },
    ]);
    await storage.purgeSourceHealthBefore('2026-01-02');
    expect(await storage.getSourceHealthSearchDaily('2026-01-01')).toHaveLength(
      4,
    );
    await storage.purgeSourceHealthBefore('2026-01-04');
    expect(await storage.getSourceHealthSearchDaily('2026-01-01')).toEqual([]);
  });

  it('aggregates reporter-days in SQL with success precedence and clears health state', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const report = {
      source: ' alpha ',
      bucketDate: '2026-01-02',
      reporter: 'a',
      success: false,
    };
    for (const success of [false, false, true, true, false])
      await storage.recordSourcePlayReport({ ...report, success });
    for (let i = 0; i < 3; i++)
      await storage.recordSourcePlayReport({ ...report, reporter: 'b' });
    await storage.recordSourcePlayReport({
      ...report,
      bucketDate: '2026-01-03',
      success: true,
    });
    await storage.recordSourcePlayReport({
      ...report,
      bucketDate: '2026-01-01',
      success: true,
    });
    await storage.recordSourcePlayReport({ ...report, source: 'beta' });
    const summaries = [
      {
        source: 'alpha',
        successReporterDays: 2,
        failureReporterDays: 1,
        lastSuccessDate: '2026-01-03',
      },
      {
        source: 'beta',
        successReporterDays: 0,
        failureReporterDays: 1,
        lastSuccessDate: null,
      },
    ];
    expect(await storage.getSourcePlayReporterSummary('2026-01-02')).toEqual(
      summaries,
    );
    await storage.purgeSourceHealthBefore('2026-01-02');
    expect(await storage.getSourcePlayReporterSummary('2026-01-01')).toEqual(
      summaries,
    );
    expect(await storage.getSourcePlayReporterSummary('2026-01-04')).toEqual(
      [],
    );
    await storage.purgeSourceHealthBefore('2026-01-04');
    expect(await storage.getSourceHealthSearchDaily('2026-01-01')).toEqual([]);
    expect(await storage.getSourcePlayReporterSummary('2026-01-01')).toEqual(
      [],
    );
  });

  it('persists user scoped data and deletes it with the user', async () => {
    const storage = new LocalSqliteStorage(':memory:');

    await storage.registerUser('demo-user', 'password');
    await storage.setPlayRecord('demo-user', 'source+1', playRecord);
    await storage.setFavorite('demo-user', 'source+1', favorite);
    await storage.setSkipConfig('demo-user', 'source', '1', skipConfig);
    await storage.setPlaybackSession('demo-user', playbackSession);
    await storage.addSearchHistory('demo-user', 'first');
    await storage.setUserMessageState('demo-user', {
      announcementReadIds: ['announcement:5000:v1'],
    });
    await storage.setDanmakuEnabledPreference('demo-user', true);
    await storage.recordUserLogin('demo-user', 1700000000000);
    await storage.addSearchHistory('demo-user', 'second');
    await storage.addSearchHistory('demo-user', 'first');

    await expect(storage.checkUserExist('demo-user')).resolves.toBe(true);
    await expect(
      storage.getPlayRecord('demo-user', 'source+1'),
    ).resolves.toEqual(playRecord);
    await expect(storage.getFavorite('demo-user', 'source+1')).resolves.toEqual(
      favorite,
    );
    await expect(
      storage.getSkipConfig('demo-user', 'source', '1'),
    ).resolves.toEqual(skipConfig);
    await expect(
      storage.getPlaybackPeriodSessions(
        'demo-user',
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        source: playbackSession.source,
        watch_seconds: playbackSession.watch_seconds,
      }),
    ]);
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([
      'first',
      'second',
    ]);
    await expect(storage.getUserMessageState('demo-user')).resolves.toEqual({
      announcementReadIds: ['announcement:5000:v1'],
    });
    await storage.updateUserMessageState('demo-user', {
      announcementReadAt: 5000,
    });
    await expect(storage.getUserMessageState('demo-user')).resolves.toEqual({
      announcementReadAt: 5000,
      announcementReadIds: [],
    });
    await expect(
      storage.getDanmakuEnabledPreference('demo-user'),
    ).resolves.toBe(true);
    await expect(
      storage.getDanmakuEnabledPreference('other-user'),
    ).resolves.toBeNull();
    await expect(storage.getUserLastLogin('demo-user')).resolves.toBe(
      1700000000000,
    );
    await expect(storage.getAllUserLastLogins()).resolves.toEqual({
      'demo-user': 1700000000000,
    });

    await storage.deleteUser('demo-user');

    await expect(storage.checkUserExist('demo-user')).resolves.toBe(false);
    await expect(storage.getAllPlayRecords('demo-user')).resolves.toEqual({});
    await expect(storage.getAllFavorites('demo-user')).resolves.toEqual({});
    await expect(storage.getAllSkipConfigs('demo-user')).resolves.toEqual({});
    await expect(
      storage.getPlaybackPeriodSessions(
        'demo-user',
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    ).resolves.toEqual([]);
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([]);
    await expect(storage.getUserMessageState('demo-user')).resolves.toEqual({});
    await expect(
      storage.getDanmakuEnabledPreference('demo-user'),
    ).resolves.toBeNull();
    await expect(storage.getUserLastLogin('demo-user')).resolves.toBeNull();
    await expect(storage.getAllUserLastLogins()).resolves.toEqual({});
  });

  it('建号即写入活跃记录', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const before = Date.now();

    await storage.registerUser('fresh-user', 'password');

    const activeAt = await storage.getUserLastLogin('fresh-user');
    expect(activeAt).not.toBeNull();
    expect(activeAt as number).toBeGreaterThanOrEqual(before);
  });

  it('原子占用邀请码名额，超出上限即失败', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
    await storage.createInviteCode({
      code: 'CODE',
      createdAt: 1,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 2,
      usedCount: 0,
    });

    await expect(storage.reserveInviteCodeUse('CODE')).resolves.toBe(true);
    await expect(storage.reserveInviteCodeUse('CODE')).resolves.toBe(true);
    await expect(storage.reserveInviteCodeUse('CODE')).resolves.toBe(false);
    await expect(storage.getAllInviteCodeUsage()).resolves.toEqual({ CODE: 2 });
  });

  it('并发占用邀请码不会超发', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
    await storage.createInviteCode({
      code: 'RUSH',
      createdAt: 1,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 5,
      usedCount: 0,
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => storage.reserveInviteCodeUse('RUSH')),
    );

    expect(results.filter(Boolean)).toHaveLength(5);
    await expect(storage.getAllInviteCodeUsage()).resolves.toEqual({ RUSH: 5 });
  });

  it('maxUses 为 0 表示不限次数', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
    await storage.createInviteCode({
      code: 'FREE',
      createdAt: 1,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 0,
      usedCount: 0,
    });

    await expect(storage.reserveInviteCodeUse('FREE')).resolves.toBe(true);
    await expect(storage.reserveInviteCodeUse('FREE')).resolves.toBe(true);
    await expect(storage.getAllInviteCodeUsage()).resolves.toEqual({ FREE: 2 });
  });

  it('首次占用以配置里的历史用量为种子', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
    await storage.createInviteCode({
      code: 'OLD',
      createdAt: 1,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 3,
      usedCount: 2,
    });

    await expect(storage.reserveInviteCodeUse('OLD')).resolves.toBe(true);
    await expect(storage.reserveInviteCodeUse('OLD')).resolves.toBe(false);
    await expect(storage.getAllInviteCodeUsage()).resolves.toEqual({ OLD: 3 });
  });

  it('种子值只在建行时生效，不会重复累加', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
    await storage.createInviteCode({
      code: 'SEED',
      createdAt: 1,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 10,
      usedCount: 1,
    });

    await storage.reserveInviteCodeUse('SEED');
    await storage.reserveInviteCodeUse('SEED');

    await expect(storage.getAllInviteCodeUsage()).resolves.toEqual({ SEED: 3 });
  });

  it('回滚邀请码次数且不会减到负数', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
    await storage.createInviteCode({
      code: 'CODE',
      createdAt: 1,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 2,
      usedCount: 0,
    });

    await storage.reserveInviteCodeUse('CODE');
    await storage.releaseInviteCodeUse('CODE');
    await expect(storage.getAllInviteCodeUsage()).resolves.toEqual({ CODE: 0 });

    await storage.releaseInviteCodeUse('CODE');
    await expect(storage.getAllInviteCodeUsage()).resolves.toEqual({ CODE: 0 });
  });

  it('回滚不存在的邀请码静默返回', async () => {
    const storage = new LocalSqliteStorage(':memory:');

    await expect(
      storage.releaseInviteCodeUse('MISSING'),
    ).resolves.toBeUndefined();
    await expect(storage.getAllInviteCodeUsage()).resolves.toEqual({});
  });

  it('删除邀请码用量后重建从零开始', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
    await storage.createInviteCode({
      code: 'CODE',
      createdAt: 1,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 1,
      usedCount: 0,
    });

    await storage.reserveInviteCodeUse('CODE');
    await storage.deleteInviteCodeUsage('CODE');

    await expect(storage.getAllInviteCodeUsage()).resolves.toEqual({});
    await storage.createInviteCode({
      code: 'CODE',
      createdAt: 2,
      expiresAt: Date.now() + 86400000,
      createdBy: 'owner',
      maxUses: 1,
    });
    await expect(storage.reserveInviteCodeUse('CODE')).resolves.toBe(true);
  });

  it('筛选分页与追更计数及客户端判定保持一致', async () => {
    await assertUpdatedPlayRecordPage(new LocalSqliteStorage(':memory:'));
  });

  it('批量删除隔离用户并同步影响追更计数', async () => {
    await assertBatchDeletePlayRecords(new LocalSqliteStorage(':memory:'));
  });

  it('paginates play records by save time', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.setPlayRecord('demo-user', 'source+old', {
      ...playRecord,
      save_time: 1000,
    });
    await storage.setPlayRecord('demo-user', 'source+middle', {
      ...playRecord,
      save_time: 2000,
    });
    await storage.setPlayRecord('demo-user', 'source+new', {
      ...playRecord,
      save_time: 3000,
    });

    const firstPage = await storage.getPlayRecordPage('demo-user', 2);
    const secondPage = await storage.getPlayRecordPage(
      'demo-user',
      2,
      2000,
      'source+middle',
    );

    expect(Object.keys(firstPage.items)).toEqual([
      'source+new',
      'source+middle',
    ]);
    expect(firstPage).toMatchObject({
      total: 3,
      nextCursor: '2000|source+middle',
    });
    expect(Object.keys(secondPage.items)).toEqual(['source+old']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('收藏库按指定条数分页并关联播放进度', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    for (const [key, saveTime] of [
      ['source+old', 1000],
      ['source+middle', 2000],
      ['source+new', 3000],
    ] as const) {
      await storage.setFavorite('demo-user', key, {
        ...favorite,
        title: key,
        save_time: saveTime,
      });
    }
    await storage.setPlayRecord('demo-user', 'source+middle', {
      ...playRecord,
      index: 4,
    });

    const query = {
      query: '',
      filter: 'all',
      sort: 'saved',
      limit: 2,
    } as const;
    const firstPage = await storage.getFavoriteLibraryPage('demo-user', query);
    const secondPage = await storage.getFavoriteLibraryPage('demo-user', {
      ...query,
      cursor: firstPage.nextCursor,
    });

    expect(firstPage.items.map((item) => item.key)).toEqual([
      'source+new',
      'source+middle',
    ]);
    expect(firstPage.items[1]?.playRecord?.index).toBe(4);
    expect(firstPage).toMatchObject({
      total: 3,
      libraryTotal: 3,
      nextCursor: expect.any(String),
    });
    expect(secondPage.items.map((item) => item.key)).toEqual(['source+old']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('个人主页收藏库排除直播后分页，库总数仍包含直播', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    for (const [key, origin] of [
      ['source+z', 'live'],
      ['source+e', 'vod'],
      ['source+d', 'live'],
      ['source+c', undefined],
      ['source+b', 'vod'],
      ['source+a', 'live'],
    ] as const) {
      await storage.setFavorite('public-user', key, {
        ...favorite,
        origin,
        save_time: 1000,
      });
    }
    const query = {
      query: '',
      filter: 'all',
      sort: 'saved',
      limit: 2,
      profileScope: 'public',
    } as const;
    const first = await storage.getFavoriteLibraryPage('public-user', query);
    const second = await storage.getFavoriteLibraryPage('public-user', {
      ...query,
      cursor: first.nextCursor,
    });
    expect(first.items.map((item) => item.key)).toEqual([
      'source+e',
      'source+c',
    ]);
    expect(first.total).toBe(3);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.libraryTotal).toBe(6);
    expect(second.items.map((item) => item.key)).toEqual(['source+b']);
    expect(second.nextCursor).toBeNull();
    expect(
      (
        await storage.getFavoriteLibraryPage('public-user', {
          query: '',
          filter: 'all',
          sort: 'saved',
          limit: 10,
        })
      ).total,
    ).toBe(6);
  });

  it('按主键游标分页读取过期元数据并排除新鲜项与直播收藏', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const now = 10_000;
    const ttlMs = 1_000;

    await storage.setPlayRecords('metadata-user', {
      'source+a': { ...playRecord, metadata_checked_at: 9_500 },
      'source+b': { ...playRecord, metadata_checked_at: 8_000 },
      'source+c': { ...playRecord },
      'source+d': { ...playRecord, metadata_checked_at: now + 1 },
      'source+e': {
        ...playRecord,
        metadata_checked_at: 'invalid' as unknown as number,
      },
    });
    await storage.setFavorite('metadata-user', 'source+a', {
      ...favorite,
      metadata_checked_at: 9_500,
    });
    await storage.setFavorite('metadata-user', 'source+b', {
      ...favorite,
      metadata_checked_at: 8_000,
    });
    await storage.setFavorite('metadata-user', 'source-live', {
      ...favorite,
      origin: 'live',
    });

    const firstRecords = await storage.getStalePlayRecordPage(
      'metadata-user',
      now,
      ttlMs,
      2,
    );
    const secondRecords = await storage.getStalePlayRecordPage(
      'metadata-user',
      now,
      ttlMs,
      2,
      firstRecords.nextCursor || undefined,
    );
    const favorites = await storage.getStaleFavoritePage(
      'metadata-user',
      now,
      ttlMs,
      10,
    );

    expect(firstRecords.items.map(({ key }) => key)).toEqual([
      'source+b',
      'source+c',
    ]);
    expect(secondRecords.items.map(({ key }) => key)).toEqual([
      'source+d',
      'source+e',
    ]);
    expect(secondRecords.nextCursor).toBeNull();
    expect(favorites.items.map(({ key }) => key)).toEqual(['source+b']);
  });

  it('按原始 JSON 快照进行播放记录与收藏 CAS', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const staleRecord = {
      ...playRecord,
      metadata_checked_at: 1,
    };
    const staleFavorite = {
      ...favorite,
      metadata_checked_at: 1,
    };

    await storage.setPlayRecord('cas-user', 'source+record', staleRecord);
    await storage.setFavorite('cas-user', 'source+favorite', staleFavorite);

    const recordPage = await storage.getStalePlayRecordPage(
      'cas-user',
      10_000,
      1_000,
      10,
    );
    const favoritePage = await storage.getStaleFavoritePage(
      'cas-user',
      10_000,
      1_000,
      10,
    );
    const recordSnapshot = recordPage.items[0]?.snapshot;
    const favoriteSnapshot = favoritePage.items[0]?.snapshot;
    expect(recordSnapshot).toBe(JSON.stringify(staleRecord));
    expect(favoriteSnapshot).toBe(JSON.stringify(staleFavorite));

    const refreshedRecord = {
      ...staleRecord,
      cover: 'refreshed-record.jpg',
      metadata_checked_at: 10_000,
    };
    const refreshedFavorite = {
      ...staleFavorite,
      cover: 'refreshed-favorite.jpg',
      metadata_checked_at: 10_000,
    };
    await expect(
      storage.setPlayRecordIfUnchanged(
        'cas-user',
        'source+record',
        refreshedRecord,
        recordSnapshot as string,
      ),
    ).resolves.toBe(true);
    await expect(
      storage.setFavoriteIfUnchanged(
        'cas-user',
        'source+favorite',
        refreshedFavorite,
        favoriteSnapshot as string,
      ),
    ).resolves.toBe(true);

    await expect(
      storage.getPlayRecord('cas-user', 'source+record'),
    ).resolves.toEqual(refreshedRecord);
    await expect(
      storage.getFavorite('cas-user', 'source+favorite'),
    ).resolves.toEqual(refreshedFavorite);

    const concurrentRecord = { ...refreshedRecord, play_time: 99 };
    const concurrentFavorite = { ...refreshedFavorite, title: '用户修改' };
    await storage.setPlayRecord('cas-user', 'source+record', concurrentRecord);
    await storage.setFavorite(
      'cas-user',
      'source+favorite',
      concurrentFavorite,
    );

    await expect(
      storage.setPlayRecordIfUnchanged(
        'cas-user',
        'source+record',
        { ...refreshedRecord, play_time: 1 },
        recordSnapshot as string,
      ),
    ).resolves.toBe(false);
    await expect(
      storage.setFavoriteIfUnchanged(
        'cas-user',
        'source+favorite',
        { ...refreshedFavorite, title: 'cron 覆盖' },
        favoriteSnapshot as string,
      ),
    ).resolves.toBe(false);
    await expect(
      storage.getPlayRecord('cas-user', 'source+record'),
    ).resolves.toEqual(concurrentRecord);
    await expect(
      storage.getFavorite('cas-user', 'source+favorite'),
    ).resolves.toEqual(concurrentFavorite);
  });

  it('作品状态与显式开关的组合决定追更查询并保留导出字段', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const records: Record<string, PlayRecord> = {};
    const expected: string[] = [];
    for (const series_status of [undefined, 'ongoing', 'ended'] as const) {
      for (const tracking_enabled of [undefined, true, false]) {
        const key = `source+${series_status}-${tracking_enabled}`;
        records[key] = {
          ...playRecord,
          index: 1,
          total_episodes: 12,
          update_baseline_episodes: 10,
          series_status,
          tracking_enabled,
        };
        if (tracking_enabled ?? series_status !== 'ended') expected.push(key);
      }
    }
    await storage.setPlayRecords('status-contract', records);
    const page = await storage.getUnreadTrackingPlayRecordPage(
      'status-contract',
      20,
    );
    expect(Object.keys(page.items).sort()).toEqual(expected.sort());
    expect(page.total).toBe(expected.length);
    expect(await storage.getAllPlayRecords('status-contract')).toEqual(records);
  });

  it('queries unread tracking records in database order without loading all records', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const makeRecord = (index: number, total: number, baseline: number) => ({
      ...playRecord,
      index: 1,
      total_episodes: total,
      save_time: index,
      metadata_checked_at: index,
      update_baseline_episodes: baseline,
      tracking_enabled: true,
    });

    await storage.setPlayRecords('demo-user', {
      'source+new': makeRecord(30, 12, 10),
      'source+old': makeRecord(20, 10, 10),
      'source+disabled': {
        ...makeRecord(40, 20, 10),
        tracking_enabled: false,
      },
    });

    const page = await storage.getUnreadTrackingPlayRecordPage('demo-user', 1);

    expect(page.total).toBe(1);
    expect(Object.keys(page.items)).toEqual(['source+new']);
    expect(page.nextCursor).toBeNull();
  });

  it('按最后更新时间清理过期播放统计会话', async () => {
    const storage = new LocalSqliteStorage(':memory:');

    await storage.setPlaybackSession('demo-user', {
      ...playbackSession,
      id: 'session_old',
      updated_at: 1000,
    });
    await storage.setPlaybackSession('demo-user', {
      ...playbackSession,
      id: 'session_recent',
      updated_at: 2000,
    });

    await expect(storage.deletePlaybackSessionsBefore(1500)).resolves.toBe(1);
    await expect(
      storage.getPlaybackPeriodSessions(
        'demo-user',
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    ).resolves.toEqual([
      expect.objectContaining({ watch_seconds: playbackSession.watch_seconds }),
    ]);
  });

  it('历史与桶统计双后端契约', async () => {
    await assertWatchHistoryContract(new LocalSqliteStorage(':memory:'));
  });

  it('reads positive playback sessions in a half-open user-scoped range', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await assertPlaybackPeriodRange(storage);
  });

  it('returns null when admin config is absent', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await expect(storage.getAdminConfig()).resolves.toBeNull();
  });

  it('throws instead of rebuilding when admin config is corrupt', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.setAdminConfig(adminConfig);

    (
      storage as unknown as {
        db: { prepare: (sql: string) => { run: (value: string) => void } };
      }
    ).db
      .prepare('UPDATE admin_config SET config_json = ? WHERE id = 1')
      .run('{not-valid-json');

    await expect(storage.getAdminConfig()).rejects.toThrow();
  });

  it('isolates current route semantics while retaining and purging both versions', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.recordSourceRouteStat({
      source: 'versioned',
      routeMode: 'browser',
      success: true,
      eventAt: Date.UTC(2026, 0, 8),
    });
    await storage.recordSourceRouteStat({
      source: 'versioned',
      routeMode: 'server',
      success: false,
      eventAt: Date.UTC(2026, 0, 8),
    });
    const database = (
      storage as unknown as {
        db: {
          prepare: (sql: string) => { run: (...values: unknown[]) => void };
        };
      }
    ).db;
    for (const mode of ['browser', 'server']) {
      database
        .prepare(
          'INSERT INTO source_route_stats (source, route_mode, bucket_date, success_count, failure_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('versioned', mode, '2026-01-08', 99, 99, 1);
    }
    expect(await storage.getSourceRouteStats('2026-01-01')).toEqual(
      expect.arrayContaining([
        {
          source: 'versioned',
          routeMode: 'browser',
          successCount: 1,
          failureCount: 0,
        },
        {
          source: 'versioned',
          routeMode: 'server',
          successCount: 0,
          failureCount: 1,
        },
      ]),
    );
    expect(await storage.getSourceRouteStats('2026-01-01')).toHaveLength(2);
    expect(
      (await storage.getAllSourceRouteStatBuckets()).map(
        (row) => row.routeMode,
      ),
    ).toEqual(
      expect.arrayContaining(['browser', 'server', 'browser-v2', 'server-v2']),
    );
    await storage.purgeSourceRouteStatsBefore('2026-01-08');
    expect(await storage.getAllSourceRouteStatBuckets()).toHaveLength(4);
    await storage.purgeSourceRouteStatsBefore('2026-01-09');
    expect(await storage.getAllSourceRouteStatBuckets()).toEqual([]);
  });

  it('aggregates source route stats by date and mode', async () => {
    const storage = new LocalSqliteStorage(':memory:');

    await storage.recordSourceRouteStat({
      source: 'source-a',
      routeMode: 'browser',
      success: true,
      eventAt: Date.UTC(2026, 0, 8),
    });
    await storage.recordSourceRouteStat({
      source: 'source-a',
      routeMode: 'browser',
      success: false,
      eventAt: Date.UTC(2026, 0, 8),
    });
    await storage.recordSourceRouteStat({
      source: 'source-a',
      routeMode: 'server',
      success: true,
      eventAt: Date.UTC(2026, 0, 7),
    });
    await storage.recordSourceRouteStat({
      source: 'source-a',
      routeMode: 'browser',
      success: true,
      eventAt: Date.UTC(2025, 11, 31),
    });
    await storage.recordSourceRouteStat({
      source: 'source-b',
      routeMode: 'browser',
      success: true,
      eventAt: Date.UTC(2026, 0, 8),
    });

    const stats = await storage.getSourceRouteStats('2026-01-02');
    await storage.purgeSourceRouteStatsBefore('2026-01-07');
    expect(await storage.getAllSourceRouteStatBuckets()).toHaveLength(3);
    expect(await storage.getSourceRouteStats('2025-01-01')).toEqual(stats);
    await storage.purgeSourceRouteStatsBefore('2026-01-08');
    expect(await storage.getAllSourceRouteStatBuckets()).toHaveLength(2);
    await storage.purgeSourceRouteStatsBefore('2026-01-09');
    expect(await storage.getAllSourceRouteStatBuckets()).toEqual([]);

    expect(sortRouteStats(stats)).toEqual([
      {
        source: 'source-a',
        routeMode: 'browser',
        successCount: 1,
        failureCount: 1,
      },
      {
        source: 'source-a',
        routeMode: 'server',
        successCount: 1,
        failureCount: 0,
      },
      {
        source: 'source-b',
        routeMode: 'browser',
        successCount: 1,
        failureCount: 0,
      },
    ]);
  });
});

describe('sqlite social username migration', () => {
  it('adds avatar_seed to legacy profiles idempotently without changing identity', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const internal = storage as unknown as {
      db: import('better-sqlite3').Database;
      migrateUserProfileAvatarSeed(): void;
    };
    try {
      internal.db.exec(`DROP TABLE user_profiles;
        CREATE TABLE user_profiles (username TEXT PRIMARY KEY, profile_id VARCHAR(12) UNIQUE, nickname VARCHAR(64), nickname_norm VARCHAR(64) UNIQUE, favorites_public INTEGER DEFAULT 0, updated_at INTEGER);
        INSERT INTO user_profiles VALUES ('alice', 'Alice0123456', 'Alice', 'alice', 1, 123);`);
      internal.migrateUserProfileAvatarSeed();
      expect(await storage.getUserProfile('alice')).toEqual({
        username: 'alice',
        profile_id: 'Alice0123456',
        nickname: 'Alice',
        avatar_seed: null,
        favorites_public: 1 as const,
        updated_at: 123,
      });
      await storage.updateUserProfile('alice', { avatarSeed: 'Avatar012345' });
      internal.migrateUserProfileAvatarSeed();
      expect((await storage.getUserProfile('alice'))?.avatar_seed).toBe(
        'Avatar012345',
      );
    } finally {
      internal.db.close();
    }
  });
  it('merges every username column while retaining canonical profile identity', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const internal = storage as unknown as {
      db: import('better-sqlite3').Database;
      migrateLegacyUsernameCasing(): void;
      backfillUserProfiles(): void;
    };
    await storage.ensureUserProfile('alice');
    await storage.ensureUserProfile('bob');
    await storage.updateUserProfile('alice', { avatarSeed: 'Canon0123456' });
    const canonical = await storage.getUserProfile('alice');
    internal.db
      .prepare(
        'INSERT INTO user_profiles (username, profile_id, nickname, nickname_norm, avatar_seed, favorites_public, updated_at) VALUES (?, ?, ?, ?, ?, 0, 1)',
      )
      .run('Alice', 'Legacy012345', 'Legacy', 'legacy', 'LegacyAvatar');
    internal.db
      .prepare(
        'INSERT INTO user_profiles (username, profile_id, avatar_seed, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run('Carol', 'Carol0123456', 'CarolAvatar1', 1);
    internal.db.exec(
      "INSERT INTO user_follows VALUES ('Alice', 'Bob', 1); INSERT INTO video_review_likes VALUES ('Bob', 'work', '2026', 'Alice', 1); INSERT INTO video_review_reports VALUES ('Alice', 'work', '2026', 'Bob', 'spam', '', 1);",
    );
    internal.migrateLegacyUsernameCasing();
    expect((await storage.getUserProfile('alice'))?.avatar_seed).toBe(
      'Canon0123456',
    );
    expect((await storage.getUserProfile('carol'))?.avatar_seed).toBe(
      'CarolAvatar1',
    );
    expect((await storage.getUserProfile('alice'))?.profile_id).toBe(
      canonical?.profile_id,
    );
    expect(
      internal.db.prepare('SELECT follower, followee FROM user_follows').all(),
    ).toEqual([{ follower: 'alice', followee: 'bob' }]);
    expect(
      internal.db.prepare('SELECT author, liker FROM video_review_likes').all(),
    ).toEqual([{ author: 'bob', liker: 'alice' }]);
    expect(
      internal.db
        .prepare('SELECT author, reporter FROM video_review_reports')
        .all(),
    ).toEqual([{ author: 'alice', reporter: 'bob' }]);
    internal.db
      .prepare('INSERT INTO users (username, password) VALUES (?, ?)')
      .run('missing', 'hash');
    internal.backfillUserProfiles();
    expect(await storage.getUserProfile('missing')).not.toBeNull();
    internal.db.close();
  });
});

describe('sqlite video review contract', () => {
  videoReviewContract(() => new LocalSqliteStorage(':memory:'));
});

describe('sqlite user danmaku contract', () => {
  userDanmakuContract(() => new LocalSqliteStorage(':memory:'));
});

test('normalizes legacy danmaku usernames even without a users row', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const internal = storage as unknown as {
    db: import('better-sqlite3').Database;
    migrateLegacyUsernameCasing(): void;
  };
  internal.db
    .prepare('INSERT INTO user_danmaku VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('legacy-id', 'dandan:1', 'Alice', 0, 'text', 0, '#ffffff', 1);
  internal.migrateLegacyUsernameCasing();
  expect((await storage.getAllUserDanmaku('alice'))[0].username).toBe('alice');
  internal.db.close();
});

describe('SQLite OAuth 身份契约', () => {
  oauthIdentityContract(() => new LocalSqliteStorage(':memory:'));
});

describe('SQLite announcements', () => {
  announcementContract(() => new LocalSqliteStorage(':memory:'));
});
