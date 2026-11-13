/** @jest-environment node */
import type Database from 'better-sqlite3';

import { LocalSqliteStorage } from '@/lib/sqlite.db';
import type { PlaybackSession, PlayRecord } from '@/lib/types';

import { validateCapsuleInput, ViewingHappinessPlans } from './storage';
import { type CapsuleInput, CAPSULE_MIN_DELAY_MS } from './types';

const now = 1_800_000_000_000;
const input: CapsuleInput = {
  title: '作品 A',
  year: '2026',
  cover: '/cover.jpg',
  source: 'a',
  videoId: '1',
  content: '给未来的自己',
  deliverAt: now + CAPSULE_MIN_DELAY_MS,
};
const record: PlayRecord = {
  title: '作品 A',
  year: '2026',
  cover: '',
  source_name: '源',
  index: 2,
  total_episodes: 2,
  play_time: 100,
  total_time: 100,
  save_time: now,
};
let storage: LocalSqliteStorage;
let sql: Database.Database;
beforeEach(() => {
  storage = new LocalSqliteStorage(':memory:');
  sql = (storage as unknown as { db: Database.Database }).db;
});
afterEach(() => sql.close());
function setRating(year: string, value: number | null) {
  sql
    .prepare(
      'INSERT OR REPLACE INTO video_reviews (username, title_norm, year, review_json, is_public, updated_at) VALUES (?, ?, ?, ?, 0, ?)',
    )
    .run('alice', '作品a', year, JSON.stringify({ rating: value }), now);
}
function session(
  id: string,
  overrides: Partial<PlaybackSession> = {},
): PlaybackSession {
  return {
    id,
    source: 'a',
    video_id: '1',
    episode_index: 1,
    title: '作品 A',
    year: '2026',
    source_name: '源',
    cover: '',
    started_at: now - 10000,
    ended_at: now - 1000,
    watch_seconds: 60,
    last_position: 100,
    total_time: 100,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}
it('完结按规范作品汇总换源会话且不把播放进度计入时长，已庆祝跨源和重看持久化', async () => {
  await storage.setPlayRecord('alice', 'a+1', record);
  await storage.setPlayRecord('alice', 'b+2', { ...record, title: '作品.A' });
  await storage.setPlaybackSession('alice', session('one'));
  await storage.setPlaybackSession(
    'alice',
    session('two', {
      source: 'b',
      video_id: '2',
      title: '作品.A',
      watch_seconds: 30,
    }),
  );
  await storage.setPlaybackSession(
    'alice',
    session('wrong-year', { year: '2025', watch_seconds: 300 }),
  );
  await storage.setPlaybackSession(
    'other',
    session('other', { watch_seconds: 300 }),
  );
  expect(await storage.getCompletion('alice', 'a+1')).toMatchObject({
    episodes: 2,
    totalWatchSeconds: 90,
    firstWatchedAt: now - 10000,
    completedAt: now,
    celebrated: false,
  });
  await storage.getCompletion('alice', 'a+1', true);
  await storage.getCompletion('alice', 'b+2', true);
  await storage.deleteAllPlayRecords('alice');
  await storage.setPlayRecord('alice', 'c+3', record);
  expect(await storage.getCompletion('alice', 'c+3')).toMatchObject({
    celebrated: true,
    totalWatchSeconds: 90,
  });
  expect(
    sql.prepare('SELECT COUNT(*) AS n FROM work_completions').get(),
  ).toEqual({ n: 1 });
  expect(await storage.getCompletion('other', 'c+3')).toBeNull();
});
it('没有观看统计时不伪造首次观看时间', async () => {
  await storage.setPlayRecord('alice', 'a+1', record);
  expect(await storage.getCompletion('alice', 'a+1')).toMatchObject({
    totalWatchSeconds: 0,
    firstWatchedAt: null,
  });
});
it('待送达不泄露正文，评分来自本人精确年份或空年份评价', async () => {
  setRating('', 8);
  const first = await storage.createCapsule('ALICE', input, now);
  expect(first).not.toHaveProperty('content');
  setRating('2026', null);
  const second = await storage.createCapsule('alice', input, now);
  expect((await storage.getCapsules('alice', null, now)).pending).toHaveLength(
    2,
  );
  expect((await storage.getCapsules('alice', null, now)).delivered).toEqual([]);
  expect(await storage.openCapsule('alice', first.id, now)).toBeNull();
  const list = await storage.getCapsules('alice', null, input.deliverAt);
  expect(list.delivered.find((item) => item.id === first.id)).toMatchObject({
    ratingThen: 8,
    ratingNow: null,
    content: input.content,
  });
  expect(list.delivered.find((item) => item.id === second.id)).toMatchObject({
    ratingThen: null,
    ratingNow: null,
  });
  setRating('2026', 9);
  expect(
    (await storage.getCapsules('alice', null, input.deliverAt)).delivered.every(
      (item) => item.ratingNow === 9,
    ),
  ).toBe(true);
});
it('未读不受30天窗口限制，联合游标按来源排序，全部已读只覆盖已送达', async () => {
  const first = await storage.createCapsule('alice', input, now);
  const future = await storage.createCapsule(
    'alice',
    { ...input, deliverAt: now + 100 * 86400000 },
    now,
  );
  const readAt = now + 40 * 86400000;
  const page = await storage.getCapsuleMessages('alice', 10, null, readAt);
  expect(page.total).toBe(1);
  expect(page.items[0]).toMatchObject({
    id: `time-capsule:${first.id}`,
    capsuleId: first.id,
    createdAt: input.deliverAt,
    writtenAt: now,
    title: input.title,
    content: input.content,
  });
  expect(
    (
      await storage.getCapsuleMessages(
        'alice',
        10,
        { createdAt: input.deliverAt, key: 'tracking:any' },
        readAt,
      )
    ).items,
  ).toHaveLength(1);
  expect(
    (
      await storage.getCapsuleMessages(
        'alice',
        10,
        { createdAt: input.deliverAt, key: 'review-reply:any' },
        readAt,
      )
    ).items,
  ).toHaveLength(0);
  await storage.readAllCapsules('alice', readAt);
  expect(
    (await storage.getCapsuleMessages('alice', 10, null, readAt)).total,
  ).toBe(0);
  expect(
    await storage.openCapsule('alice', first.id, readAt + 1),
  ).toMatchObject({ openedAt: readAt });
  expect(await storage.openCapsule('bob', first.id, readAt)).toBeNull();
  expect(await storage.deleteCapsule('bob', first.id)).toBe(false);
  expect(await storage.deleteCapsule('alice', future.id)).toBe(true);
});
it('已送达列表使用SQL游标，同毫秒翻页没有重复遗漏', async () => {
  for (let i = 0; i < 53; i++) await storage.createCapsule('alice', input, now);
  const first = await storage.getCapsules('alice', null, input.deliverAt);
  const next = await storage.getCapsules(
    'alice',
    first.nextCursor,
    input.deliverAt,
  );
  expect(first.delivered).toHaveLength(50);
  expect(next.delivered).toHaveLength(3);
  expect(
    new Set([...first.delivered, ...next.delivered].map((item) => item.id))
      .size,
  ).toBe(53);
  expect(next.nextCursor).toBeNull();
  await expect(storage.getCapsules('alice', 'bad', now)).rejects.toThrow(
    '分页',
  );
});
it('限制待送达100封，已有送达不占名额，正文和时间校验在存储边界执行', async () => {
  for (let i = 0; i < 100; i++)
    await storage.createCapsule('alice', input, now);
  await expect(
    storage.createCapsule('alice', input, now),
  ).rejects.toMatchObject({ status: 409 });
  await storage.createCapsule(
    'alice',
    { ...input, deliverAt: input.deliverAt + CAPSULE_MIN_DELAY_MS },
    input.deliverAt,
  );
  expect(() =>
    validateCapsuleInput({ ...input, content: '字'.repeat(501) }, now),
  ).toThrow();
  expect(() =>
    validateCapsuleInput({ ...input, deliverAt: now }, now),
  ).toThrow();
  expect(() =>
    validateCapsuleInput(
      { ...input, deliverAt: now + 6 * 365 * 86400000 },
      now,
    ),
  ).toThrow();
});
it('SQLite 用户名合并保留全部信件并合并庆祝标记，删除用户清除两表', async () => {
  await storage.registerUser('alice', 'password');
  const letter = await storage.createCapsule('alice', input, now);
  sql
    .prepare('UPDATE time_capsules SET username = ? WHERE id = ?')
    .run('ALICE', letter.id);
  sql
    .prepare('INSERT INTO work_completions VALUES (?, ?, ?, ?)')
    .run('ALICE', '作品a', '2026', 100);
  sql
    .prepare('INSERT INTO work_completions VALUES (?, ?, ?, ?)')
    .run('alice', '作品a', '2026', 200);
  (
    storage as unknown as { migrateLegacyUsernameCasing(): void }
  ).migrateLegacyUsernameCasing();
  expect((await storage.getCapsules('alice', null, now)).pending).toHaveLength(
    1,
  );
  expect(sql.prepare('SELECT * FROM work_completions').all()).toEqual([
    {
      username: 'alice',
      title_norm: '作品a',
      year: '2026',
      celebrated_at: 100,
    },
  ]);
  await storage.deleteUser('alice');
  expect(sql.prepare('SELECT * FROM time_capsules').all()).toEqual([]);
  expect(sql.prepare('SELECT * FROM work_completions').all()).toEqual([]);
});
it('MySQL 建信计划先锁消息状态行，再检查额度并读取精确评分', () => {
  const plan = new ViewingHappinessPlans('mysql').createCapsule(
    'ALICE',
    input,
    now,
  );
  expect(plan.next().value).toMatchObject({
    sql: expect.stringContaining('INSERT IGNORE INTO user_message_state'),
    params: ['alice'],
  });
  expect(plan.next([]).value).toMatchObject({
    sql: expect.stringContaining('FOR UPDATE'),
  });
  expect(plan.next([]).value).toMatchObject({
    sql: expect.stringContaining('COUNT(*)'),
  });
  expect(plan.next([{ total: 0 }]).value).toMatchObject({
    sql: expect.stringContaining('CASE WHEN year = ?'),
  });
  expect(plan.next([{ review_json: '{"rating":8.5}' }]).value).toMatchObject({
    sql: expect.stringContaining('INSERT INTO time_capsules'),
    params: expect.arrayContaining([8.5]),
  });
});

it('v2 会话使用服务端时间桶累计，与现有观看统计一致，重复上报不翻倍', async () => {
  await storage.setPlayRecord('alice', 'a+1', record);
  const value = session('v2', { watch_seconds: 999, last_position: 900 });
  const buckets = [
    { start: Math.floor(now / 900000) * 900000, watch_ms: 12345 },
  ];
  await storage.saveWatchSessionReport('alice', value, buckets);
  await storage.saveWatchSessionReport('alice', value, buckets);
  const totals = await storage.getPlaybackWatchTotals('alice', 0);
  expect(totals.totalWatchSeconds).toBe(12);
  expect((await storage.getCompletion('alice', 'a+1'))?.totalWatchSeconds).toBe(
    totals.totalWatchSeconds,
  );
});

it('轻量计数覆盖全部已送达、未读和待送达，隔离用户且空账户为零', async () => {
  expect(await storage.countCapsules('alice', now)).toEqual({
    pending: 0,
    delivered: 0,
    unread: 0,
  });
  const first = await storage.createCapsule('alice', input, now);
  await storage.createCapsule(
    'alice',
    { ...input, deliverAt: input.deliverAt + 10000 },
    now,
  );
  await storage.createCapsule('bobby', input, now);
  expect(await storage.countCapsules('alice', input.deliverAt)).toEqual({
    pending: 1,
    delivered: 1,
    unread: 1,
  });
  await storage.openCapsule('alice', first.id, input.deliverAt);
  expect(await storage.countCapsules('alice', input.deliverAt)).toEqual({
    pending: 1,
    delivered: 1,
    unread: 0,
  });
});
