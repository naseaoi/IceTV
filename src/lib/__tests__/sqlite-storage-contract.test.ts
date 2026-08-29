/** @jest-environment node */

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
  it('persists user scoped data and deletes it with the user', async () => {
    const storage = new LocalSqliteStorage(':memory:');

    await storage.registerUser('demo-user', 'password');
    await storage.setPlayRecord('demo-user', 'source+1', playRecord);
    await storage.setFavorite('demo-user', 'source+1', favorite);
    await storage.setSkipConfig('demo-user', 'source', '1', skipConfig);
    await storage.setPlaybackSession('demo-user', playbackSession);
    await storage.addSearchHistory('demo-user', 'first');
    await storage.setUserMessageState('demo-user', {
      readAnnouncementId: 'announcement:v1',
    });
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
    await expect(storage.getPlaybackSessions('demo-user')).resolves.toEqual([
      playbackSession,
    ]);
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([
      'first',
      'second',
    ]);
    await expect(storage.getUserMessageState('demo-user')).resolves.toEqual({
      readAnnouncementId: 'announcement:v1',
    });
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
    await expect(storage.getPlaybackSessions('demo-user')).resolves.toEqual([]);
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([]);
    await expect(storage.getUserMessageState('demo-user')).resolves.toEqual({});
    await expect(storage.getUserLastLogin('demo-user')).resolves.toBeNull();
    await expect(storage.getAllUserLastLogins()).resolves.toEqual({});
  });

  it('searches playback sessions before applying the page limit', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const recentSession: PlaybackSession = {
      ...playbackSession,
      id: 'session_recent',
      title: 'Recent Show',
      started_at: 3000,
    };
    const matchedSession: PlaybackSession = {
      ...playbackSession,
      id: 'session_matched',
      video_id: 'hidden-video',
      title: 'Hidden Gem',
      started_at: 2000,
    };
    const otherUserSession: PlaybackSession = {
      ...matchedSession,
      id: 'session_other_user',
      started_at: 4000,
    };

    await storage.setPlaybackSession('demo-user', recentSession);
    await storage.setPlaybackSession('demo-user', matchedSession);
    await storage.setPlaybackSession('other-user', otherUserSession);

    await expect(
      storage.getPlaybackSessions('demo-user', { limit: 1, keyword: 'hidden' }),
    ).resolves.toEqual([matchedSession]);
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

  it('paginates favorites with matching play progress', async () => {
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

    const firstPage = await storage.getFavoritePage('demo-user', 2);
    const secondPage = await storage.getFavoritePage(
      'demo-user',
      2,
      2000,
      'source+middle',
    );

    expect(firstPage.items.map((item) => item.key)).toEqual([
      'source+new',
      'source+middle',
    ]);
    expect(firstPage.items[1]?.playRecord?.index).toBe(4);
    expect(firstPage).toMatchObject({
      total: 3,
      nextCursor: '2000|source+middle',
    });
    expect(secondPage.items.map((item) => item.key)).toEqual(['source+old']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('replaces all data from an import snapshot', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const passwordHash =
      '$2b$10$abcdefghijklmnopqrstuu9dBwFh6R0D4A5gHfHnM6kQ7xS8tT9u';

    await storage.replaceAllData({
      adminConfig,
      users: {
        'demo-user': passwordHash,
      },
      userData: {
        'demo-user': {
          playRecords: { 'source+1': playRecord },
          favorites: { 'source+1': favorite },
          searchHistory: ['first', 'second'],
          skipConfigs: { 'source+1': skipConfig },
          playbackSessions: { [playbackSession.id]: playbackSession },
          messageState: { readAnnouncementId: 'announcement:v1' },
          lastLoginAt: 1700000000000,
        },
      },
      sourceRouteStats: [
        {
          source: 'source-a',
          routeMode: 'browser',
          bucketDate: '2026-01-08',
          successCount: 3,
          failureCount: 1,
        },
      ],
    });

    await expect(storage.getAdminConfig()).resolves.toEqual(adminConfig);
    await expect(storage.getAllUsers()).resolves.toEqual(['demo-user']);
    await expect(storage.getAllUsersWithPasswords()).resolves.toEqual({
      'demo-user': passwordHash,
    });
    await expect(storage.getAllPlayRecords('demo-user')).resolves.toEqual({
      'source+1': playRecord,
    });
    await expect(storage.getAllFavorites('demo-user')).resolves.toEqual({
      'source+1': favorite,
    });
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([
      'first',
      'second',
    ]);
    await expect(storage.getAllSkipConfigs('demo-user')).resolves.toEqual({
      'source+1': skipConfig,
    });
    await expect(storage.getPlaybackSessions('demo-user')).resolves.toEqual([
      playbackSession,
    ]);
    await expect(storage.getUserMessageState('demo-user')).resolves.toEqual({
      readAnnouncementId: 'announcement:v1',
    });
    await expect(storage.getUserLastLogin('demo-user')).resolves.toBe(
      1700000000000,
    );
    await expect(storage.getAllSourceRouteStatBuckets()).resolves.toEqual([
      {
        source: 'source-a',
        routeMode: 'browser',
        bucketDate: '2026-01-08',
        successCount: 3,
        failureCount: 1,
      },
    ]);
    await expect(storage.getSourceRouteStats('2026-01-01')).resolves.toEqual([
      {
        source: 'source-a',
        routeMode: 'browser',
        successCount: 3,
        failureCount: 1,
      },
    ]);
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

  it('keeps legacy short usernames when replacing data', async () => {
    const storage = new LocalSqliteStorage(':memory:');

    await storage.replaceAllData({
      adminConfig,
      users: { abc: 'legacy-password-hash', admin: 'admin-password-hash' },
      userData: {},
      sourceRouteStats: [],
    });

    await expect(storage.getAllUsers()).resolves.toEqual(['abc', 'admin']);
  });

  it('returns all playback sessions without page limit', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const total = 510;

    for (let index = 0; index < total; index += 1) {
      await storage.setPlaybackSession('demo-user', {
        ...playbackSession,
        id: `session_bulk_${index}`,
        started_at: 1000 + index,
      });
    }

    const limited = await storage.getPlaybackSessions('demo-user', {
      limit: 10000,
    });
    const all = await storage.getAllPlaybackSessions('demo-user');

    expect(limited).toHaveLength(500);
    expect(all).toHaveLength(total);
    expect(all[0].id).toBe(`session_bulk_${total - 1}`);
    expect(all[total - 1].id).toBe('session_bulk_0');
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
    await expect(storage.getAllPlaybackSessions('demo-user')).resolves.toEqual([
      expect.objectContaining({ id: 'session_recent' }),
    ]);
  });

  it('aggregates playback ranges and top items in set-based queries', async () => {
    const storage = new LocalSqliteStorage(':memory:');

    await storage.setPlaybackSession('demo-user', {
      ...playbackSession,
      id: 'show-a-old',
      title: 'Show A',
      started_at: 100,
      ended_at: 160,
      watch_seconds: 60,
    });
    await storage.setPlaybackSession('demo-user', {
      ...playbackSession,
      id: 'show-a-latest',
      title: ' Show A ',
      started_at: 300,
      ended_at: 360,
      watch_seconds: 120,
    });
    await storage.setPlaybackSession('demo-user', {
      ...playbackSession,
      id: 'show-b',
      video_id: '2',
      title: 'Show B',
      started_at: 200,
      ended_at: 260,
      watch_seconds: 200,
    });
    await storage.setPlaybackSession('other-user', {
      ...playbackSession,
      id: 'other-user-show',
      started_at: 250,
      ended_at: 350,
      watch_seconds: 999,
    });

    await expect(
      storage.getPlaybackRangeWatchTotals('demo-user', [
        { key: 'early', start: 0, end: 200 },
        { key: 'recent', start: 200, end: 400 },
      ]),
    ).resolves.toEqual([
      { key: 'early', watchSeconds: 60 },
      { key: 'recent', watchSeconds: 320 },
    ]);

    await storage.setPlaybackSession('demo-user', {
      ...playbackSession,
      id: 'show-a-other-source',
      source: 'source-b',
      video_id: '3',
      title: 'Show A',
      started_at: 250,
      ended_at: 280,
      watch_seconds: 30,
    });

    await expect(
      storage.getPlaybackTopItems('demo-user', 6, 100),
    ).resolves.toEqual([
      expect.objectContaining({
        videoId: '1',
        title: ' Show A ',
        watchSeconds: 210,
        sessionCount: 3,
        lastWatchedAt: 360,
      }),
      expect.objectContaining({
        videoId: '2',
        title: 'Show B',
        watchSeconds: 200,
        sessionCount: 1,
        lastWatchedAt: 260,
      }),
    ]);
  });

  it('returns null when admin config is absent', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await expect(storage.getAdminConfig()).resolves.toBeNull();
  });

  it('throws instead of rebuilding when admin config is corrupt', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.replaceAllData({
      adminConfig,
      users: {},
      userData: {},
      sourceRouteStats: [],
    });

    (
      storage as unknown as {
        db: { prepare: (sql: string) => { run: (value: string) => void } };
      }
    ).db
      .prepare('UPDATE admin_config SET config_json = ? WHERE id = 1')
      .run('{not-valid-json');

    await expect(storage.getAdminConfig()).rejects.toThrow();
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
