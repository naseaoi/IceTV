/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockGetConfig = jest.fn();
const mockGetAllUsers = jest.fn();
const mockGetAllPlayRecords = jest.fn();
const mockGetAllFavorites = jest.fn();
const mockSavePlayRecord = jest.fn();
const mockSaveFavorite = jest.fn();
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
  refineConfig: jest.fn((config) => config),
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
    getAllUsers: (...args: unknown[]) => mockGetAllUsers(...args),
    getAllPlayRecords: (...args: unknown[]) => mockGetAllPlayRecords(...args),
    getAllFavorites: (...args: unknown[]) => mockGetAllFavorites(...args),
    savePlayRecord: (...args: unknown[]) => mockSavePlayRecord(...args),
    saveFavorite: (...args: unknown[]) => mockSaveFavorite(...args),
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

async function flushBackgroundTask() {
  for (let index = 0; index < 8; index += 1) {
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
  const originalMetadataTimeBudgetMs = process.env.CRON_METADATA_TIME_BUDGET_MS;
  const originalPlaybackStatsRetentionDays =
    process.env.CRON_PLAYBACK_STATS_RETENTION_DAYS;

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    delete process.env.CRON_METADATA_REFRESH_TTL_MS;
    delete process.env.CRON_METADATA_MAX_ITEMS;
    delete process.env.CRON_METADATA_TIME_BUDGET_MS;
    delete process.env.CRON_PLAYBACK_STATS_RETENTION_DAYS;
    jest.clearAllMocks();
    mockGetAllUsers.mockReset().mockResolvedValue([]);
    mockGetAllPlayRecords.mockReset().mockResolvedValue({});
    mockGetAllFavorites.mockReset().mockResolvedValue({});
    mockSavePlayRecord.mockReset().mockResolvedValue(undefined);
    mockSaveFavorite.mockReset().mockResolvedValue(undefined);
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
      'CRON_METADATA_TIME_BUDGET_MS',
      originalMetadataTimeBudgetMs,
    );
    restoreEnvironmentVariable(
      'CRON_PLAYBACK_STATS_RETENTION_DAYS',
      originalPlaybackStatsRetentionDays,
    );
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
    expect(mockSavePlayRecord).not.toHaveBeenCalled();
    expect(mockSaveFavorite).not.toHaveBeenCalled();
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

    expect(mockSavePlayRecord).toHaveBeenCalledWith(
      'user',
      'source',
      '1',
      expect.objectContaining({
        metadata_checked_at: expect.any(Number),
      }),
    );
    expect(
      mockSavePlayRecord.mock.calls[0][3].metadata_checked_at,
    ).toBeGreaterThan(1);
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

    expect(mockSavePlayRecord).toHaveBeenCalledTimes(1);
    expect(mockSaveFavorite).toHaveBeenCalledTimes(1);
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
      expect(mockSavePlayRecord).toHaveBeenCalledTimes(1);
      expect(mockSaveFavorite).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
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
    expect(mockSavePlayRecord).toHaveBeenCalledTimes(1);
    expect(mockSaveFavorite).toHaveBeenCalledTimes(1);
  });
});

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
