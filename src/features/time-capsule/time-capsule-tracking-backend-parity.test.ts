/** @jest-environment node */
import type { Pool } from 'mysql2/promise';

import { resetMysqlTestData } from '@/lib/__tests__/__fixtures__/mysql-test-data';
import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';
import { MySqlStorage } from '@/lib/mysql.db';
import type { PlaybackSession, PlayRecord } from '@/lib/types';

import { type CapsuleInput, CAPSULE_MIN_DELAY_MS } from './types';

const liveUrl = process.env.MYSQL_TEST_URL?.trim();
(liveUrl ? describe : describe.skip)('MySQL 观后信与完结（真实实例）', () => {
  let storage: MySqlStorage;
  const now = 1800000000000;
  const input: CapsuleInput = {
    title: videoReview.title,
    year: videoReview.year,
    cover: '',
    source: 'a',
    videoId: '1',
    content: '未来见',
    deliverAt: now + CAPSULE_MIN_DELAY_MS,
  };
  beforeAll(() => {
    storage = new MySqlStorage(liveUrl);
  });
  beforeEach(async () => resetMysqlTestData(storage));
  afterAll(async () => (storage as unknown as { pool: Pool }).pool.end());
  it('写入、评分精确优先、分页、未读、用户隔离与删除级联', async () => {
    await storage.registerUser('alice', 'password');
    await storage.setVideoReview('alice', {
      ...videoReview,
      year: '',
      rating: 8,
      is_public: false,
    });
    const first = await storage.createCapsule('ALICE', input, now);
    expect(first).not.toHaveProperty('content');
    await storage.setVideoReview('alice', {
      ...videoReview,
      rating: null,
      is_public: false,
    });
    // 使用原始 SQL 建精确年份，规避写评价接口按空年份合并的业务行为。
    await (storage as unknown as { pool: Pool }).pool.execute(
      'INSERT INTO video_reviews (username, title_norm, year, review_json, is_public, updated_at) VALUES (?, ?, ?, ?, 0, ?) ON DUPLICATE KEY UPDATE review_json = VALUES(review_json)',
      [
        'alice',
        videoReview.title_norm,
        input.year,
        JSON.stringify({ ...videoReview, rating: null }),
        now,
      ],
    );
    const second = await storage.createCapsule('alice', input, now);
    expect(await storage.countCapsules('alice', now)).toEqual({
      pending: 2,
      delivered: 0,
      unread: 0,
    });
    const deliveredAt = input.deliverAt + 40 * 86400000;
    const page = await storage.getCapsules('alice', null, deliveredAt);
    expect(page.delivered.find((item) => item.id === first.id)).toMatchObject({
      ratingThen: 8,
      ratingNow: null,
    });
    expect(page.delivered.find((item) => item.id === second.id)).toMatchObject({
      ratingThen: null,
    });
    const messages = await storage.getCapsuleMessages(
      'alice',
      1,
      null,
      deliveredAt,
    );
    expect(messages.total).toBe(2);
    const next = await storage.getCapsuleMessages(
      'alice',
      1,
      { createdAt: input.deliverAt, key: messages.items[0].id },
      deliveredAt,
    );
    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).not.toBe(messages.items[0].id);
    expect(await storage.openCapsule('bob', first.id, deliveredAt)).toBeNull();
    expect(await storage.openCapsule('alice', first.id, now)).toBeNull();
    await storage.readAllCapsules('alice', deliveredAt);
    expect(await storage.countCapsules('alice', deliveredAt)).toEqual({
      pending: 0,
      delivered: 2,
      unread: 0,
    });
    expect(
      await storage.openCapsule('alice', first.id, deliveredAt + 1),
    ).toMatchObject({ openedAt: deliveredAt });
    expect(await storage.deleteCapsule('bob', second.id)).toBe(false);
    await storage.deleteUser('alice');
    expect(await storage.countCapsules('alice', deliveredAt)).toEqual({
      pending: 0,
      delivered: 0,
      unread: 0,
    });
  });
  it('并发创建最多100封，站长无users行同样受锁保护', async () => {
    for (let i = 0; i < 99; i++)
      await storage.createCapsule('owner', input, now);
    const results = await Promise.allSettled([
      storage.createCapsule('owner', input, now),
      storage.createCapsule('owner', input, now),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await storage.countCapsules('owner', now)).toEqual({
      pending: 100,
      delivered: 0,
      unread: 0,
    });
  });
  it('按作品匹配换源统计并保持庆祝幂等，删账户清除标记', async () => {
    await storage.registerUser('alice', 'password');
    const record: PlayRecord = {
      title: '作品A',
      year: '2026',
      cover: '',
      source_name: '源',
      index: 1,
      total_episodes: 1,
      play_time: 500,
      total_time: 500,
      save_time: now,
    };
    await storage.setPlayRecord('alice', 'a+1', record);
    const session: PlaybackSession = {
      id: 'one',
      source: 'b',
      video_id: '2',
      episode_index: 1,
      title: '作品.A',
      source_name: '源B',
      cover: '',
      year: '2026',
      started_at: now - 1000,
      ended_at: now,
      watch_seconds: 42,
      last_position: 500,
      total_time: 500,
      created_at: now,
      updated_at: now,
    };
    await storage.setPlaybackSession('alice', session);
    await storage.setPlayRecord('alice', 'accent+1', {
      ...record,
      title: 'Cafe',
    });
    await storage.setPlaybackSession('alice', {
      ...session,
      id: 'plain',
      title: 'Cafe',
      watch_seconds: 7,
    });
    await storage.setPlaybackSession('alice', {
      ...session,
      id: 'accented',
      title: 'Café',
      watch_seconds: 500,
    });
    expect(await storage.getCompletion('alice', 'accent+1')).toMatchObject({
      totalWatchSeconds: 7,
    });
    expect(await storage.getCompletion('alice', 'a+1')).toMatchObject({
      totalWatchSeconds: 42,
      celebrated: false,
    });
    await storage.getCompletion('alice', 'a+1', true);
    await storage.getCompletion('alice', 'a+1', true);
    expect(await storage.getCompletion('alice', 'a+1')).toMatchObject({
      celebrated: true,
    });
    await storage.deleteUser('alice');
    const [rows] = await (storage as unknown as { pool: Pool }).pool.query(
      'SELECT * FROM work_completions WHERE username = ?',
      ['alice'],
    );
    expect(rows).toEqual([]);
  });
});
