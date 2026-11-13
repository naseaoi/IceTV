/** @jest-environment node */
import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import type { Favorite, VideoReview } from '@/lib/types';
import { tasteMatchScore } from '@/lib/viewing-insights';

installCryptoPolyfill();
let storage: LocalSqliteStorage;
const review = (
  title = '作品',
  extra: Partial<VideoReview> = {},
): VideoReview => ({
  title,
  title_norm: title,
  year: '2026',
  cover: '',
  douban_id: 0,
  rating: 8,
  content: '',
  is_public: true,
  spoiler: false,
  source_key: '',
  created_at: 1,
  updated_at: 1,
  ...extra,
});
const favorite = (title: string, extra: Partial<Favorite> = {}): Favorite => ({
  title,
  year: '2026',
  cover: '',
  total_episodes: 10,
  save_time: 1,
  source_name: '源',
  ...extra,
});
beforeEach(() => {
  storage = new LocalSqliteStorage(':memory:');
});
afterEach(() => {
  (storage as unknown as { db: { close(): void } }).db.close();
});

it('相合度阈值、舍入和上下界', () => {
  expect(tasteMatchScore(4, 0)).toBeNull();
  expect(tasteMatchScore(5, 0)).toBe(100);
  expect(tasteMatchScore(5, 5)).toBe(78);
  expect(tasteMatchScore(5, 22.5)).toBe(0);
  expect(tasteMatchScore(5, 45)).toBe(0);
});

it('批量状态共用手动、评分与播放进度推导，并规范化身份', async () => {
  await storage.setFavorite(
    'viewer',
    'source+1',
    favorite('作品', { watch_status: 'planned' }),
  );
  await storage.setVideoReview('viewer', review());
  await storage.setFavorite('viewer', 'source+2', favorite('评分'));
  await storage.setVideoReview('viewer', review('评分', { is_public: false }));
  await storage.setFavorite(
    'viewer',
    'source+3',
    favorite('播放', { year: '' }),
  );
  await storage.setPlayRecord('viewer', 'source+3', {
    title: '播放',
    year: '',
    cover: '',
    source_name: '源',
    total_episodes: 10,
    index: 10,
    play_time: 90,
    total_time: 100,
    save_time: 10,
  });
  expect(
    await storage.getWorkWatchStatuses('VIEWER', [
      { title: ' 作 品 ', year: '2026' },
      { title: '评分', year: '2026' },
      { title: '播放', year: '2025' },
      { title: '无收藏', year: '' },
    ]),
  ).toEqual(['planned', 'completed', 'completed', null]);
  expect(await storage.getWorkWatchStatuses('viewer', [])).toEqual([]);
});

it('关注看法按公开等级与评价隐私筛选并每人计一次', async () => {
  for (const [user, visibility] of [
    ['hidden', 0],
    ['public', 2],
    ['reviewer', 1],
    ['private', 3],
  ] as const) {
    await storage.ensureUserProfile(user);
    await storage.updateUserProfile(user, { libraryVisibility: visibility });
    await storage.setUserFollow('viewer', user, true);
  }
  await storage.setFavorite(
    'hidden',
    'source+1',
    favorite('作品', { watch_status: 'completed' }),
  );
  await storage.setFavorite(
    'public',
    'source+1',
    favorite('作品', { watch_status: 'completed' }),
  );
  await storage.setVideoReview('reviewer', review());
  await storage.setVideoReview(
    'private',
    review('作品', { is_public: false, rating: 10 }),
  );
  await storage.setVideoReview(
    'private',
    review('作品', { year: '', rating: 9 }),
  );
  const result = await storage.getFollowOpinions('viewer', '作品', '2026');
  expect(result).toMatchObject({
    watchedCount: 1,
    ratedCount: 1,
    averageRating: 8,
  });
  expect(
    result.items.map((item) => [
      item.status,
      item.rating,
      item.hasPublicReview,
    ]),
  ).toEqual([
    ['completed', null, false],
    [null, 8, true],
  ]);
  expect(JSON.stringify(result)).not.toContain('username');
});

it('相合度只读取对方公开评分，推荐排除本人评价与已看状态，保留想看', async () => {
  await storage.ensureUserProfile('peer');
  for (let i = 0; i < 5; i++) {
    await storage.setVideoReview(
      'viewer',
      review(`共同${i}`, { rating: 7, is_public: false }),
    );
    await storage.setVideoReview('peer', review(`共同${i}`, { rating: 8 }));
  }
  await storage.setVideoReview(
    'peer',
    review('私密', { is_public: false, rating: 10 }),
  );
  for (const title of ['在看', '想看', '看过', '只有正文', '没看'])
    await storage.setVideoReview('peer', review(title, { rating: 9 }));
  await storage.setFavorite(
    'viewer',
    'source+1',
    favorite('在看', { watch_status: 'watching' }),
  );
  await storage.setFavorite(
    'viewer',
    'source+2',
    favorite('想看', { watch_status: 'planned' }),
  );
  await storage.setFavorite(
    'viewer',
    'source+3',
    favorite('看过', { watch_status: 'completed' }),
  );
  await storage.setVideoReview(
    'viewer',
    review('只有正文', { rating: null, is_public: false }),
  );
  const result = await storage.getTasteMatch('viewer', 'peer');
  expect(result).toMatchObject({ commonCount: 5, score: 78 });
  expect(result.picks.map((item) => item.title).sort()).toEqual(
    ['想看', '没看'].sort(),
  );
});

it('关注分组跨页不重不漏，并拒绝跨作品游标', async () => {
  const followed: string[] = [];
  for (let i = 0; i < 43; i++) {
    const user = `author${i}`;
    const profile = await storage.ensureUserProfile(user);
    await storage.setVideoReview(user, review('作品', { updated_at: i + 1 }));
    if (i < 23) {
      await storage.setUserFollow('viewer', user, true);
      followed.push(profile.profile_id);
    }
  }
  const first = await storage.getWorkVideoReviewPage('作品', '2026', 'viewer');
  const second = await storage.getWorkVideoReviewPage(
    '作品',
    '2026',
    'viewer',
    first.nextCursor!,
  );
  const third = await storage.getWorkVideoReviewPage(
    '作品',
    '2026',
    'viewer',
    second.nextCursor!,
  );
  const all = [...first.reviews, ...second.reviews, ...third.reviews];
  expect(all).toHaveLength(43);
  expect(new Set(all.map((item) => item.author.profileId)).size).toBe(43);
  expect(
    all
      .slice(0, 23)
      .every(
        (item) =>
          item.authorFollowed && followed.includes(item.author.profileId),
      ),
  ).toBe(true);
  expect(all.slice(23).every((item) => !item.authorFollowed)).toBe(true);
  expect(third.nextCursor).toBeNull();
  await expect(
    storage.getWorkVideoReviewPage('其他', '2026', 'viewer', first.nextCursor!),
  ).rejects.toThrow();
  const guest = await storage.getWorkVideoReviewPage('作品', '2026', '');
  expect(guest.reviews.every((item) => item.authorFollowed === false)).toBe(
    true,
  );
});
