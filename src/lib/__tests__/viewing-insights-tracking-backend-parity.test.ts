/** @jest-environment node */
import type { Pool } from 'mysql2/promise';

import { resetMysqlTestData } from '@/lib/__tests__/__fixtures__/mysql-test-data';
import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';
import { MySqlStorage } from '@/lib/mysql.db';

const liveUrl = process.env.MYSQL_TEST_URL?.trim();
(liveUrl ? describe : describe.skip)('观影看法与口味 MySQL 真实查询', () => {
  let storage: MySqlStorage;
  beforeAll(() => {
    storage = new MySqlStorage(liveUrl);
  });
  beforeEach(async () => resetMysqlTestData(storage));
  afterAll(async () => (storage as unknown as { pool: Pool }).pool.end());
  it('状态批量匹配、公开看法、口味聚合与关注游标', async () => {
    await storage.ensureUserProfile('peer');
    await storage.updateUserProfile('peer', { libraryVisibility: 2 });
    await storage.setUserFollow('viewer', 'peer', true);
    for (const user of ['viewer', 'peer'])
      await storage.setFavorite(user, 'source+1', {
        title: videoReview.title,
        year: '2026',
        cover: '',
        total_episodes: 1,
        source_name: '源',
        save_time: 1,
        watch_status: user === 'peer' ? 'completed' : 'planned',
      });
    await storage.setVideoReview('peer', videoReview);
    expect(
      await storage.getWorkWatchStatuses('viewer', [
        { title: videoReview.title, year: '2026' },
        { title: '不存在', year: '' },
      ]),
    ).toEqual(['planned', null]);
    expect(
      await storage.getFollowOpinions('viewer', videoReview.title_norm, '2026'),
    ).toMatchObject({ watchedCount: 1, ratedCount: 1, averageRating: 8 });
    expect((await storage.getTasteMatch('viewer', 'peer')).picks).toHaveLength(
      1,
    );
    for (let i = 0; i < 5; i++) {
      await storage.setVideoReview('viewer', {
        ...videoReview,
        title: `共同${i}`,
        title_norm: `共同${i}`,
        rating: 7,
        is_public: false,
      });
      await storage.setVideoReview('peer', {
        ...videoReview,
        title: `共同${i}`,
        title_norm: `共同${i}`,
        rating: 8,
      });
    }
    expect(await storage.getTasteMatch('viewer', 'peer')).toMatchObject({
      commonCount: 5,
      score: 78,
    });
    for (let i = 0; i < 21; i++) {
      const author = `author${i}`;
      await storage.ensureUserProfile(author);
      await storage.setVideoReview(author, {
        ...videoReview,
        updated_at: 9000 + i,
      });
    }
    const first = await storage.getWorkVideoReviewPage(
      videoReview.title_norm,
      '2026',
      'viewer',
    );
    const second = await storage.getWorkVideoReviewPage(
      videoReview.title_norm,
      '2026',
      'viewer',
      first.nextCursor!,
    );
    expect(first.reviews[0].authorFollowed).toBe(true);
    expect(
      new Set(
        [...first.reviews, ...second.reviews].map(
          (item) => item.author.profileId,
        ),
      ).size,
    ).toBe(22);
  }, 20000);
});
