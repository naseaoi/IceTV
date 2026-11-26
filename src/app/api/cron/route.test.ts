/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import type {
  MetadataRefreshCursor,
  MetadataRefreshKind,
  MetadataRefreshPage,
} from '@/lib/types';

installWebPolyfills();

const mockGetConfig = jest.fn();
const mockGetAllUsers = jest.fn();
const mockGetAllPlayRecords = jest.fn();
const mockGetAllFavorites = jest.fn();
const mockGetMetadataRefreshPage = jest.fn();
const mockGetStalePlayRecordPage = jest.fn();
const mockGetStaleFavoritePage = jest.fn();
const mockSavePlayRecordIfUnchanged = jest.fn();
const mockSaveFavoriteIfUnchanged = jest.fn();
const mockDeletePlaybackSessionsBefore = jest.fn();
const mockFetchVideoDetail = jest.fn();
const mockGetOwnerUsername = jest.fn();
const mockAcquireCronLease = jest.fn();
const mockLeaseRelease = jest.fn();

jest.mock('@/features/live/lib/live', () => ({
  isLiveEntryEnabledInConfig: jest.fn().mockReturnValue(false),
  refreshLiveChannelSources: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  getConfigForRead: (...args: unknown[]) => mockGetConfig(...args),
  invalidateConfigCache: jest.fn(),
  ConfigConflictError: class extends Error {},
  refineConfig: jest.fn((config) => config),
  configSelfCheck: jest.fn((config) => config),
  saveConfig: jest.fn(),
}));

jest.mock('@/lib/config-subscription', () => ({
  decodeConfigSubscriptionContent: jest.fn(),
  readConfigSubscriptionText: jest.fn(),
}));

jest.mock('@/lib/cron-lease', () => ({
  acquireCronLease: (...args: unknown[]) => mockAcquireCronLease(...args),
}));

jest.mock('@/lib/db', () => ({
  db: {
    getConfigSubscription: jest.fn().mockResolvedValue({
      ConfigFile: '',
      ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
    }),
    getAllUsers: (...args: unknown[]) => mockGetAllUsers(...args),
    getAllPlayRecords: (...args: unknown[]) => mockGetAllPlayRecords(...args),
    getAllFavorites: (...args: unknown[]) => mockGetAllFavorites(...args),
    getMetadataRefreshPage: (...args: unknown[]) =>
      mockGetMetadataRefreshPage(...args),
    getStalePlayRecordPage: (...args: unknown[]) =>
      mockGetStalePlayRecordPage(...args),
    getStaleFavoritePage: (...args: unknown[]) =>
      mockGetStaleFavoritePage(...args),
    savePlayRecordIfUnchanged: (...args: unknown[]) =>
      mockSavePlayRecordIfUnchanged(...args),
    saveFavoriteIfUnchanged: (...args: unknown[]) =>
      mockSaveFavoriteIfUnchanged(...args),
    deletePlaybackSessionsBefore: (...args: unknown[]) =>
      mockDeletePlaybackSessionsBefore(...args),
  },
}));

jest.mock('@/lib/env.server', () => ({
  getOwnerUsername: (...args: unknown[]) => mockGetOwnerUsername(...args),
}));

jest.mock('@/lib/fetchVideoDetail', () => ({
  fetchVideoDetail: (...args: unknown[]) => mockFetchVideoDetail(...args),
}));

jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: jest.fn(),
}));

const { GET } = require('./route') as typeof import('./route');

function createRequest(url = 'http://localhost/api/cron'): NextRequest {
  return {
    url,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'authorization' ? 'Bearer test-secret' : null,
    },
  } as unknown as NextRequest;
}

function createPlayRecord(overrides: Record<string, unknown> = {}) {
  return {
    title: '测试视频',
    source_name: '测试源',
    cover: 'cover.jpg',
    year: '2026',
    index: 1,
    total_episodes: 1,
    play_time: 10,
    total_time: 100,
    save_time: 1,
    ...overrides,
  };
}

function createFavorite(overrides: Record<string, unknown> = {}) {
  return {
    title: '测试视频',
    source_name: '测试源',
    cover: 'cover.jpg',
    year: '2026',
    total_episodes: 1,
    save_time: 1,
    ...overrides,
  };
}

async function buildMockMetadataPage(
  kind: MetadataRefreshKind,
  limit: number,
  cursor?: MetadataRefreshCursor,
  workKey?: string,
): Promise<MetadataRefreshPage> {
  const users = new Set<string>(await mockGetAllUsers());
  const owner = mockGetOwnerUsername();
  if (owner) users.add(owner.toLowerCase());
  const rows: MetadataRefreshPage['items'] = [];
  for (const user of users) {
    const values = await (kind === 'record'
      ? mockGetAllPlayRecords(user)
      : mockGetAllFavorites(user));
    for (const [key, item] of Object.entries(values)) {
      if (workKey !== undefined && key !== workKey) continue;
      if (
        cursor &&
        !(key > cursor.key || (key === cursor.key && user > cursor.user))
      )
        continue;
      rows.push({ user, key, snapshot: JSON.stringify(item) });
    }
  }
  rows.sort(
    (a, b) => a.key.localeCompare(b.key) || a.user.localeCompare(b.user),
  );
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: rows.length > limit ? { key: last.key, user: last.user } : null,
  };
}

async function flushBackgroundTask() {
  for (let index = 0; index < 100; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function runMetadataTask() {
  const response = await GET(
    createRequest('http://localhost/api/cron?task=metadata'),
  );
  expect(response.status).toBe(200);
  await flushBackgroundTask();
}

describe('cron route', () => {
  const originalCronSecret = process.env.CRON_SECRET;
  const originalMetadataRefreshTtlMs = process.env.CRON_METADATA_REFRESH_TTL_MS;
  const originalMetadataMaxItems = process.env.CRON_METADATA_MAX_ITEMS;
  const originalMetadataRecordMaxItems =
    process.env.CRON_METADATA_RECORD_MAX_ITEMS;
  const originalMetadataFavoriteMaxItems =
    process.env.CRON_METADATA_FAVORITE_MAX_ITEMS;
  const originalMetadataPageSize = process.env.CRON_METADATA_PAGE_SIZE;
  const originalMetadataTimeBudgetMs = process.env.CRON_METADATA_TIME_BUDGET_MS;
  const originalPlaybackStatsRetentionDays =
    process.env.CRON_PLAYBACK_STATS_RETENTION_DAYS;

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    delete process.env.CRON_METADATA_REFRESH_TTL_MS;
    delete process.env.CRON_METADATA_MAX_ITEMS;
    delete process.env.CRON_METADATA_RECORD_MAX_ITEMS;
    delete process.env.CRON_METADATA_FAVORITE_MAX_ITEMS;
    delete process.env.CRON_METADATA_PAGE_SIZE;
    delete process.env.CRON_METADATA_TIME_BUDGET_MS;
    delete process.env.CRON_PLAYBACK_STATS_RETENTION_DAYS;
    jest.clearAllMocks();
    mockGetAllUsers.mockReset().mockResolvedValue([]);
    mockGetAllPlayRecords.mockReset().mockResolvedValue({});
    mockGetAllFavorites.mockReset().mockResolvedValue({});
    mockGetStalePlayRecordPage.mockReset();
    mockGetStaleFavoritePage.mockReset();
    mockGetMetadataRefreshPage
      .mockReset()
      .mockImplementation(buildMockMetadataPage);
    mockSavePlayRecordIfUnchanged.mockReset().mockResolvedValue(true);
    mockSaveFavoriteIfUnchanged.mockReset().mockResolvedValue(true);
    mockDeletePlaybackSessionsBefore.mockReset().mockResolvedValue(0);
    mockFetchVideoDetail.mockReset().mockResolvedValue(null);
    mockGetOwnerUsername.mockReset().mockReturnValue('');
    mockLeaseRelease.mockReset().mockResolvedValue(undefined);
    mockAcquireCronLease.mockReset().mockResolvedValue({
      isHeld: () => true,
      release: (...args: unknown[]) => mockLeaseRelease(...args),
    });
    mockGetConfig.mockReset().mockResolvedValue({
      ConfigSubscribtion: { URL: '', AutoUpdate: false },
      LiveConfig: [],
    });
  });

  afterAll(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }

    restoreEnvironmentVariable(
      'CRON_METADATA_REFRESH_TTL_MS',
      originalMetadataRefreshTtlMs,
    );
    restoreEnvironmentVariable(
      'CRON_METADATA_MAX_ITEMS',
      originalMetadataMaxItems,
    );
    restoreEnvironmentVariable(
      'CRON_METADATA_RECORD_MAX_ITEMS',
      originalMetadataRecordMaxItems,
    );
    restoreEnvironmentVariable(
      'CRON_METADATA_FAVORITE_MAX_ITEMS',
      originalMetadataFavoriteMaxItems,
    );
    restoreEnvironmentVariable(
      'CRON_METADATA_PAGE_SIZE',
      originalMetadataPageSize,
    );
    restoreEnvironmentVariable(
      'CRON_METADATA_TIME_BUDGET_MS',
      originalMetadataTimeBudgetMs,
    );
    restoreEnvironmentVariable(
      'CRON_PLAYBACK_STATS_RETENTION_DAYS',
      originalPlaybackStatsRetentionDays,
    );
  });

  it('扫描超时后两类游标独立推进，尾部与回绕前段均可入选', async () => {
    const { refreshRecordAndFavorites } =
      await import('@/lib/cron/metadata-refresh');
    await refreshRecordAndFavorites();
    process.env.CRON_METADATA_TIME_BUDGET_MS = '1000';
    process.env.CRON_METADATA_PAGE_SIZE = '1';
    let now = 100_000_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const rows = Object.fromEntries(
      (['record', 'favorite'] as const).map((kind) => [
        kind,
        ['a', 'b', 'c', 'd', 'e'].map((id) => ({
          user: 'user',
          key: `${kind}+${id}`,
          snapshot: JSON.stringify(
            createPlayRecord({ metadata_checked_at: id === 'e' ? 0 : now }),
          ),
        })),
      ]),
    ) as Record<MetadataRefreshKind, MetadataRefreshPage['items']>;
    const starts: Array<[MetadataRefreshKind, string | undefined]> = [];
    mockGetMetadataRefreshPage.mockImplementation(
      async (
        kind: MetadataRefreshKind,
        _limit: number,
        cursor?: MetadataRefreshCursor,
        workKey?: string,
      ) => {
        if (workKey !== undefined)
          return {
            items: rows[kind].filter((row) => row.key === workKey),
            nextCursor: null,
          };
        starts.push([kind, cursor?.key]);
        now += 60;
        const remaining = rows[kind].filter(
          (row) => !cursor || row.key > cursor.key,
        );
        const items = remaining.slice(0, 1);
        return {
          items,
          nextCursor:
            remaining.length > 1
              ? { key: items[0].key, user: items[0].user }
              : null,
        };
      },
    );
    mockFetchVideoDetail.mockResolvedValue({
      episodes: ['ep'],
      title: 'refreshed',
    });
    try {
      await refreshRecordAndFavorites();
      expect(mockFetchVideoDetail).not.toHaveBeenCalled();
      starts.length = 0;
      await refreshRecordAndFavorites();
      expect(starts).toEqual([
        ['record', 'record+b'],
        ['record', 'record+c'],
        ['favorite', 'favorite+b'],
        ['favorite', 'favorite+c'],
      ]);
      expect(mockFetchVideoDetail).not.toHaveBeenCalled();
      for (const kind of ['record', 'favorite'] as const) {
        rows[kind][0].snapshot = JSON.stringify(
          createPlayRecord({ metadata_checked_at: 0 }),
        );
      }
      starts.length = 0;
      await refreshRecordAndFavorites();
      expect(starts).toEqual([
        ['record', 'record+d'],
        ['record', undefined],
        ['favorite', 'favorite+d'],
        ['favorite', undefined],
      ]);
      expect(
        mockFetchVideoDetail.mock.calls
          .map(([request]) => `${request.source}+${request.id}`)
          .sort(),
      ).toEqual(['favorite+a', 'favorite+e', 'record+a', 'record+e']);
      // 放宽预算完成一整圈，回绕重遇同一作品时只回源一次。
      process.env.CRON_METADATA_TIME_BUDGET_MS = '10000';
      mockFetchVideoDetail.mockClear();
      await refreshRecordAndFavorites();
      expect(mockFetchVideoDetail).toHaveBeenCalledTimes(4);
    } finally {
      clock.mockRestore();
      mockGetMetadataRefreshPage.mockImplementation(buildMockMetadataPage);
      await refreshRecordAndFavorites();
    }
  });

  it('同一进程内拒绝重叠执行', async () => {
    let releaseFirstConfig!: (config: object) => void;
    mockGetConfig
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstConfig = resolve;
          }),
      )
      .mockResolvedValue({
        ConfigSubscribtion: { URL: '', AutoUpdate: false },
        LiveConfig: [],
      });

    const firstResponse = await GET(createRequest());
    const secondResponse = await GET(createRequest());

    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toMatchObject({
      success: true,
      message: 'Cron job started',
    });
    expect(mockLeaseRelease).not.toHaveBeenCalled();
    expect(secondResponse.status).toBe(202);

    releaseFirstConfig({
      ConfigSubscribtion: { URL: '', AutoUpdate: false },
      LiveConfig: [],
    });
    await flushBackgroundTask();

    const thirdResponse = await GET(createRequest());
    expect(thirdResponse.status).toBe(200);
    await flushBackgroundTask();
    expect(mockLeaseRelease).toHaveBeenCalled();
  });

  it('拒绝未知任务类型', async () => {
    const response = await GET(
      createRequest('http://localhost/api/cron?task=unknown'),
    );

    expect(response.status).toBe(400);
  });

  it('跨进程租约被占用时跳过任务', async () => {
    mockAcquireCronLease.mockResolvedValueOnce(null);

    const response = await GET(
      createRequest('http://localhost/api/cron?task=metadata'),
    );

    expect(response.status).toBe(202);
    expect(mockGetAllUsers).not.toHaveBeenCalled();
  });

  it('默认不清理播放统计历史', async () => {
    await runMetadataTask();

    expect(mockDeletePlaybackSessionsBefore).not.toHaveBeenCalled();
  });

  it('显式设置保留期后清理长期未更新的播放统计', async () => {
    process.env.CRON_PLAYBACK_STATS_RETENTION_DAYS = '30';
    mockDeletePlaybackSessionsBefore.mockResolvedValue(2);

    await runMetadataTask();

    expect(mockDeletePlaybackSessionsBefore).toHaveBeenCalledTimes(1);
    const [cutoff] = mockDeletePlaybackSessionsBefore.mock.calls[0];
    expect(cutoff).toEqual(expect.any(Number));
    expect(cutoff).toBeLessThan(Date.now());
  });

  it('TTL 内的记录和收藏不重复获取详情', async () => {
    const checkedAt = Date.now() - 60_000;
    mockGetAllUsers.mockResolvedValue(['user']);
    mockGetAllPlayRecords.mockResolvedValue({
      'source+1': createPlayRecord({ metadata_checked_at: checkedAt }),
    });
    mockGetAllFavorites.mockResolvedValue({
      'source+2': createFavorite({ metadata_checked_at: checkedAt }),
    });

    await runMetadataTask();

    expect(mockFetchVideoDetail).not.toHaveBeenCalled();
    expect(mockSavePlayRecordIfUnchanged).not.toHaveBeenCalled();
    expect(mockSaveFavoriteIfUnchanged).not.toHaveBeenCalled();
  });

  it('为过期条目保存最新元数据检查时间', async () => {
    mockGetAllUsers.mockResolvedValue(['user']);
    mockGetAllPlayRecords.mockResolvedValue({
      'source+1': createPlayRecord({ metadata_checked_at: 1 }),
    });
    mockFetchVideoDetail.mockResolvedValue({
      title: '测试视频',
      poster: 'cover.jpg',
      year: '2026',
      episodes: ['第 1 集'],
    });

    await runMetadataTask();

    expect(mockSavePlayRecordIfUnchanged).toHaveBeenCalledWith(
      'user',
      'source',
      '1',
      expect.objectContaining({
        metadata_checked_at: expect.any(Number),
      }),
      expect.any(String),
    );
    expect(
      mockSavePlayRecordIfUnchanged.mock.calls[0][3].metadata_checked_at,
    ).toBeGreaterThan(1);
  });

  it('CAS 失败时跳过并发变更的记录与收藏', async () => {
    mockGetAllUsers.mockResolvedValue(['user']);
    mockGetAllPlayRecords.mockResolvedValue({
      'source+1': createPlayRecord({ metadata_checked_at: 1 }),
    });
    mockGetAllFavorites.mockResolvedValue({
      'source+2': createFavorite({ metadata_checked_at: 1 }),
    });
    mockFetchVideoDetail.mockResolvedValue({
      title: '测试视频',
      poster: 'cover.jpg',
      year: '2026',
      episodes: ['第 1 集'],
    });
    mockSavePlayRecordIfUnchanged.mockResolvedValue(false);
    mockSaveFavoriteIfUnchanged.mockResolvedValue(false);

    await runMetadataTask();

    expect(mockSavePlayRecordIfUnchanged).toHaveBeenCalledWith(
      'user',
      'source',
      '1',
      expect.anything(),
      expect.any(String),
    );
    expect(mockSaveFavoriteIfUnchanged).toHaveBeenCalledWith(
      'user',
      'source',
      '2',
      expect.anything(),
      expect.any(String),
    );
  });

  it('播放记录条目上限不影响收藏的独立预算', async () => {
    process.env.CRON_METADATA_MAX_ITEMS = '1';
    mockGetAllUsers.mockResolvedValue(['user']);
    mockGetAllPlayRecords.mockResolvedValue({
      'source+1': createPlayRecord(),
      'source+2': createPlayRecord({ title: '第二个视频' }),
    });
    mockGetAllFavorites.mockResolvedValue({
      'source+3': createFavorite(),
    });
    mockFetchVideoDetail.mockResolvedValue({
      title: '测试视频',
      poster: 'cover.jpg',
      year: '2026',
      episodes: ['第 1 集'],
    });

    await runMetadataTask();

    expect(mockSavePlayRecordIfUnchanged).toHaveBeenCalledTimes(1);
    expect(mockSaveFavoriteIfUnchanged).toHaveBeenCalledTimes(1);
  });

  it('分页扫描后仍按候选优先级选取前 N 条', async () => {
    process.env.CRON_METADATA_PAGE_SIZE = '1';
    process.env.CRON_METADATA_RECORD_MAX_ITEMS = '1';
    mockGetAllUsers.mockResolvedValue(['user']);
    mockGetAllPlayRecords.mockResolvedValue({
      'source+a': createPlayRecord({
        tracking_enabled: false,
        metadata_checked_at: 1,
      }),
      'source+z': createPlayRecord({
        index: 1,
        total_episodes: 10,
        metadata_checked_at: 1,
      }),
    });
    mockFetchVideoDetail.mockResolvedValue({
      title: '测试视频',
      poster: 'cover.jpg',
      year: '2026',
      episodes: ['第 1 集'],
    });

    await runMetadataTask();

    expect(mockSavePlayRecordIfUnchanged).toHaveBeenCalledTimes(1);
    expect(mockSavePlayRecordIfUnchanged).toHaveBeenCalledWith(
      'user',
      'source',
      'z',
      expect.anything(),
      expect.any(String),
    );
    expect(mockGetStalePlayRecordPage).not.toHaveBeenCalled();
    expect(
      mockGetMetadataRefreshPage.mock.calls.filter(
        ([kind, , , key]) => kind === 'record' && key === undefined,
      ),
    ).toHaveLength(2);
  });

  it('元数据任务不回退到全量读取接口', async () => {
    mockGetAllUsers.mockResolvedValue(['user']);
    mockGetAllPlayRecords.mockImplementation(() => {
      throw new Error('不应调用全量播放记录读取');
    });
    mockGetAllFavorites.mockImplementation(() => {
      throw new Error('不应调用全量收藏读取');
    });
    mockGetMetadataRefreshPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    await runMetadataTask();

    expect(mockGetAllPlayRecords).not.toHaveBeenCalled();
    expect(mockGetAllFavorites).not.toHaveBeenCalled();
    expect(mockGetAllUsers).not.toHaveBeenCalled();
    expect(mockGetStalePlayRecordPage).not.toHaveBeenCalled();
    expect(mockGetStaleFavoritePage).not.toHaveBeenCalled();
    expect(mockGetMetadataRefreshPage).toHaveBeenCalledTimes(2);
  });

  it('同一作品跨 162 个用户只占一份预算，并同步新鲜记录与收藏', async () => {
    process.env.CRON_METADATA_RECORD_MAX_ITEMS = '1';
    process.env.CRON_METADATA_FAVORITE_MAX_ITEMS = '1';
    const users = Array.from(
      { length: 162 },
      (_, index) => `user-${String(index).padStart(3, '0')}`,
    );
    mockGetAllUsers.mockResolvedValue(users);
    mockGetAllPlayRecords.mockImplementation(async (user: string) => ({
      'source+1': createPlayRecord({
        metadata_checked_at: user === users[0] ? 1 : Date.now(),
      }),
      'source+2': createPlayRecord({ metadata_checked_at: 2 }),
    }));
    mockGetAllFavorites.mockImplementation(async (user: string) =>
      user === users[0]
        ? {
            'source+1': createFavorite(),
            'source+3': createFavorite(),
          }
        : {},
    );
    mockFetchVideoDetail.mockResolvedValue({
      title: '新标题',
      poster: 'new.jpg',
      year: '2026',
      episodes: ['1', '2'],
    });

    await runMetadataTask();

    expect(mockFetchVideoDetail).toHaveBeenCalledTimes(2);
    expect(mockFetchVideoDetail.mock.calls.map(([input]) => input.id)).toEqual([
      '1',
      '3',
    ]);
    expect(mockSavePlayRecordIfUnchanged).toHaveBeenCalledTimes(162);
    expect(
      new Set(mockSavePlayRecordIfUnchanged.mock.calls.map(([user]) => user)),
    ).toEqual(new Set(users));
    for (const [, , id, next, snapshot] of mockSavePlayRecordIfUnchanged.mock
      .calls) {
      expect(id).toBe('1');
      expect(next).toMatchObject({
        total_episodes: 2,
        update_baseline_episodes: 1,
        update_detected_at: expect.any(Number),
      });
      expect(JSON.parse(snapshot).total_episodes).toBe(1);
    }
    expect(mockSaveFavoriteIfUnchanged).toHaveBeenCalledTimes(2);
    expect(mockGetStalePlayRecordPage).not.toHaveBeenCalled();
    expect(mockGetStaleFavoritePage).not.toHaveBeenCalled();
  });

  it('候选收集达到预算后停止翻页，并给刷新保留时间', async () => {
    process.env.CRON_METADATA_TIME_BUDGET_MS = '100';
    let currentTime = 1000;
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockImplementation(() => currentTime);
    mockGetMetadataRefreshPage.mockImplementation(
      async (kind, _limit, _cursor, key) => {
        if (kind === 'favorite') return { items: [], nextCursor: null };
        const row = {
          user: 'user',
          key: 'source+1',
          snapshot: JSON.stringify(createPlayRecord()),
        };
        if (key) return { items: [row], nextCursor: null };
        currentTime += 11;
        return { items: [row], nextCursor: { key: 'source+1', user: 'user' } };
      },
    );
    mockFetchVideoDetail.mockResolvedValue({ episodes: ['1'] });
    try {
      await runMetadataTask();
      expect(
        mockGetMetadataRefreshPage.mock.calls.filter(
          ([kind, , , key]) => kind === 'record' && !key,
        ),
      ).toHaveLength(1);
      expect(mockFetchVideoDetail).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('达到时间预算后不再处理后续条目', async () => {
    process.env.CRON_METADATA_TIME_BUDGET_MS = '10';
    let currentTime = 1000;
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockImplementation(() => currentTime);
    mockGetAllUsers.mockResolvedValue(['user']);
    mockGetAllPlayRecords.mockResolvedValue({
      'source+1': createPlayRecord(),
      'source+2': createPlayRecord({ title: '第二个视频' }),
    });
    mockFetchVideoDetail.mockImplementation(async () => {
      currentTime += 20;
      return {
        title: '测试视频',
        poster: 'cover.jpg',
        year: '2026',
        episodes: ['第 1 集'],
      };
    });

    try {
      await runMetadataTask();

      expect(mockFetchVideoDetail).toHaveBeenCalledTimes(1);
      expect(mockSavePlayRecordIfUnchanged).toHaveBeenCalledTimes(1);
      expect(mockSaveFavoriteIfUnchanged).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it.each([0, 1])(
    '收藏详情集数为 %s 时独立更新封面并保留集数和保存时间',
    async (count) => {
      mockGetAllUsers.mockResolvedValue(['user']);
      const favorite = createFavorite();
      mockGetAllFavorites.mockResolvedValue({ 'source+1': favorite });
      mockFetchVideoDetail.mockResolvedValue({
        title: '新标题',
        poster: 'new-cover.jpg',
        year: '2027',
        episodes: Array.from({ length: count }, () => '第 1 集'),
      });
      await runMetadataTask();
      expect(mockSaveFavoriteIfUnchanged).toHaveBeenCalledWith(
        'user',
        'source',
        '1',
        expect.objectContaining({
          cover: 'new-cover.jpg',
          total_episodes: 1,
          save_time: 1,
          title: favorite.title,
          year: favorite.year,
        }),
        JSON.stringify(favorite),
      );
    },
  );

  it('收藏详情空封面保留旧值，集数变化仍更新标题与年份', async () => {
    mockGetAllUsers.mockResolvedValue(['user']);
    mockGetAllFavorites.mockResolvedValue({ 'source+1': createFavorite() });
    mockFetchVideoDetail.mockResolvedValue({
      title: '新标题',
      poster: '',
      year: '2027',
      episodes: ['1', '2'],
    });
    await runMetadataTask();
    expect(mockSaveFavoriteIfUnchanged.mock.calls[0][3]).toMatchObject({
      cover: 'cover.jpg',
      total_episodes: 2,
      title: '新标题',
      year: '2027',
      save_time: 1,
    });
  });

  it('记录和收藏中的同一视频复用详情请求', async () => {
    mockGetAllUsers.mockResolvedValue(['user']);
    mockGetAllPlayRecords.mockResolvedValue({
      'source+1': createPlayRecord(),
    });
    mockGetAllFavorites.mockResolvedValue({
      'source+1': createFavorite(),
    });
    mockFetchVideoDetail.mockResolvedValue({
      title: '更新后标题',
      poster: 'updated.jpg',
      year: '2026',
      episodes: ['第 1 集', '第 2 集'],
    });

    await runMetadataTask();

    expect(mockFetchVideoDetail).toHaveBeenCalledTimes(1);
    expect(mockSavePlayRecordIfUnchanged).toHaveBeenCalledTimes(1);
    expect(mockSaveFavoriteIfUnchanged).toHaveBeenCalledTimes(1);
  });
});

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
