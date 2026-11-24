/** @jest-environment node */

import { cookies } from 'next/headers';

import { getServerAuthSession } from '@/lib/auth-session.server';
import {
  getContinueWatchingInitialData,
  getContinueWatchingPageData,
  getContinueWatchingSkeletonCount,
} from '@/lib/continue-watching.server';
import { selectPlayRecordPage } from '@/lib/play-records';
import type { PlayRecord } from '@/lib/types';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('@/lib/auth-session.server', () => ({
  getServerAuthSession: jest.fn(),
}));

const mockGetPlayRecordPage = jest.fn();
const mockGetUnreadTrackingPlayRecordPage = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    getPlayRecordPage: (...args: unknown[]) => mockGetPlayRecordPage(...args),
    getUnreadTrackingPlayRecordPage: (...args: unknown[]) =>
      mockGetUnreadTrackingPlayRecordPage(...args),
  },
}));

const mockCookies = cookies as jest.Mock;
const mockGetServerAuthSession = getServerAuthSession as jest.Mock;

function mockCookieStore(values: Record<string, string>) {
  mockCookies.mockResolvedValue({
    get: (name: string) =>
      values[name] === undefined ? undefined : { value: values[name] },
  });
}

describe('getContinueWatchingSkeletonCount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerAuthSession.mockResolvedValue({ status: 'guest' });
  });

  it('未登录时不读取播放记录数量', async () => {
    mockCookieStore({ cw_count: '6' });

    await expect(getContinueWatchingSkeletonCount()).resolves.toBe(0);
    expect(mockGetServerAuthSession).not.toHaveBeenCalled();
  });

  it('会话无效时不返回继续观看骨架数量', async () => {
    mockCookieStore({ auth: 'invalid', cw_count: '6' });

    await expect(getContinueWatchingSkeletonCount()).resolves.toBe(0);
    expect(mockGetServerAuthSession).toHaveBeenCalledWith('invalid');
  });

  it('reads the full-page count independently of the home row and caps it at its page size', async () => {
    mockCookieStore({ auth: 'valid', cw_count: '4', cw_page_count: '100' });
    mockGetServerAuthSession.mockResolvedValue({ status: 'authenticated' });
    await expect(
      getContinueWatchingSkeletonCount({
        cookieName: 'cw_page_count',
        limit: 24,
      }),
    ).resolves.toBe(24);
    await expect(getContinueWatchingSkeletonCount()).resolves.toBe(4);
  });

  it.each(['', '-1', 'Infinity', 'invalid'])(
    'treats invalid page count %s as unknown',
    async (count) => {
      mockCookieStore({ auth: 'valid', cw_page_count: count });
      mockGetServerAuthSession.mockResolvedValue({ status: 'authenticated' });
      await expect(
        getContinueWatchingSkeletonCount({
          cookieName: 'cw_page_count',
          limit: 24,
        }),
      ).resolves.toBe(0);
    },
  );

  it('仅为已登录用户返回限制后的骨架数量', async () => {
    mockCookieStore({ auth: 'valid', cw_count: '12' });
    mockGetServerAuthSession.mockResolvedValue({
      status: 'authenticated',
      username: 'alice',
      role: 'user',
    });

    await expect(getContinueWatchingSkeletonCount()).resolves.toBe(8);
  });
});

it('首页 SSR 只传列表摘要，保留主进度和更新计数', async () => {
  mockCookieStore({ auth: 'valid' });
  mockGetServerAuthSession.mockResolvedValue({
    status: 'authenticated',
    username: 'tester',
  });
  const summary: PlayRecord = {
    title: '作品',
    source_name: '源站',
    cover: '',
    year: '2026',
    index: 2,
    total_episodes: 50,
    play_time: 120,
    total_time: 1800,
    save_time: 300,
  };
  const episodeProgress = Array.from({ length: 50 }, (_, index) => ({
    k: `n:${index + 1}`,
    t: 120,
    d: 1800,
    at: 300,
  }));
  const full = Object.freeze({ ...summary, episode_progress: episodeProgress });
  const items = Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => [`s+${index}`, full]),
  );
  mockGetPlayRecordPage.mockImplementation(
    (_username, _limit, _cursor, _options, filter) => ({
      items: filter === 'updated' ? {} : items,
      total: filter === 'updated' ? 2 : 20,
      nextCursor: null,
    }),
  );
  const result = await getContinueWatchingInitialData();
  expect(mockGetPlayRecordPage).toHaveBeenCalledWith('tester', 10);
  expect(result.updateCount).toBe(2);
  expect(result.records).toEqual(
    Object.fromEntries(Object.keys(items).map((key) => [key, summary])),
  );
  expect(full.episode_progress).toBe(episodeProgress);
  expect(Buffer.byteLength(JSON.stringify(result.records))).toBeLessThan(
    Buffer.byteLength(JSON.stringify(items)),
  );
});

it('消息已读后追更页初始计数与首页更新数保持一致，卡片已读才清零', async () => {
  jest.clearAllMocks();
  mockCookieStore({ auth: 'valid', cw_page_count: '1' });
  mockGetServerAuthSession.mockResolvedValue({
    status: 'authenticated',
    username: 'tester',
  });
  let record: PlayRecord = {
    title: '作品',
    source_name: '源站',
    cover: '',
    year: '2026',
    index: 5,
    total_episodes: 9,
    update_baseline_episodes: 8,
    play_time: 120,
    total_time: 1800,
    save_time: Date.now(),
  };
  mockGetUnreadTrackingPlayRecordPage.mockResolvedValue({ total: 0 });
  mockGetPlayRecordPage.mockImplementation(
    (_username, limit, cursor, _options, filter) =>
      selectPlayRecordPage({ 's+1': record }, limit, cursor, { filter }),
  );

  const expectCounts = async (updated: number) => {
    await expect(getContinueWatchingPageData(24)).resolves.toMatchObject({
      skeletonCount: 1,
      counts: { all: 1, updated, shelved: 0 },
    });
    await expect(getContinueWatchingInitialData()).resolves.toMatchObject({
      updateCount: updated,
    });
  };
  await expectCounts(1);
  record = { ...record, update_message_read_episodes: 9 };
  await expectCounts(1);
  record = { ...record, update_baseline_episodes: 9 };
  await expectCounts(0);
  expect(mockGetUnreadTrackingPlayRecordPage).not.toHaveBeenCalled();
  expect(mockGetPlayRecordPage).toHaveBeenCalledWith(
    'tester',
    1,
    undefined,
    undefined,
    'updated',
  );
});
