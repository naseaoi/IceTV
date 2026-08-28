/** @jest-environment node */

import { MySqlStorage } from '../mysql.db';
import { hasPlayRecordUpdate } from '../play-records';
import { LocalSqliteStorage } from '../sqlite.db';
import type { PlayRecord } from '../types';

const liveUrl = (process.env.MYSQL_TEST_URL || '').trim();
const describeParity = liveUrl ? describe : describe.skip;

const base: PlayRecord = {
  title: '剧集',
  source_name: '源',
  year: '2026',
  cover: '',
  index: 1,
  total_episodes: 12,
  play_time: 0,
  total_time: 0,
  save_time: 1,
};

const make = (
  detectedAt: number,
  extra: Partial<PlayRecord> = {},
): PlayRecord => ({
  ...base,
  save_time: detectedAt,
  metadata_checked_at: detectedAt,
  ...extra,
});

// 覆盖两侧谓词的每个分支：布尔默认、集数刻度、分组刻度、缺字段、脏值、边界相等
const CASES: Record<string, PlayRecord> = {
  'k+unread': make(100, { total_episodes: 12, update_baseline_episodes: 10 }),
  'k+read': make(90, { total_episodes: 10, update_baseline_episodes: 10 }),
  'k+finished': make(80, {
    index: 12,
    total_episodes: 12,
    update_baseline_episodes: 10,
  }),
  'k+disabled': make(70, {
    total_episodes: 20,
    update_baseline_episodes: 10,
    tracking_enabled: false,
  }),
  'k+enabled-explicit': make(60, {
    total_episodes: 20,
    update_baseline_episodes: 10,
    tracking_enabled: true,
  }),
  'k+no-baseline': make(50, { total_episodes: 12 }),
  'k+group-unread': make(40, {
    group_index: 1,
    group_total: 4,
    update_baseline_group_total: 2,
    total_episodes: 99,
    update_baseline_episodes: 99,
  }),
  'k+group-read': make(30, {
    group_index: 2,
    group_total: 2,
    update_baseline_group_total: 2,
    total_episodes: 99,
    update_baseline_episodes: 1,
  }),
  'k+group-zero': make(20, {
    group_index: 0,
    group_total: 0,
    total_episodes: 12,
    update_baseline_episodes: 10,
  }),
  'k+baseline-above-total': make(10, {
    total_episodes: 10,
    update_baseline_episodes: 20,
  }),
  // 只有 group_total 没有 group_index，回落到集数刻度
  'k+group-total-only': make(11, {
    index: 5,
    total_episodes: 20,
    group_total: 10,
    update_baseline_group_total: 10,
    update_baseline_episodes: 10,
  }),
  'k+null-total': make(9, {
    total_episodes: null as unknown as number,
    update_baseline_episodes: 1,
  }),
  'k+string-total': make(8, {
    total_episodes: 'abc' as unknown as number,
    update_baseline_episodes: 1,
  }),
  'k+equal-boundary': make(7, {
    index: 11,
    total_episodes: 12,
    update_baseline_episodes: 11,
  }),
};

describeParity('追更谓词双后端一致性', () => {
  let mysqlStorage: MySqlStorage;
  let sqliteStorage: LocalSqliteStorage;

  beforeAll(() => {
    mysqlStorage = new MySqlStorage(liveUrl);
    sqliteStorage = new LocalSqliteStorage(':memory:');
  });

  afterAll(async () => {
    await (
      mysqlStorage as unknown as { pool: { end: () => Promise<void> } }
    ).pool.end();
  });

  it('同一批记录在 MySQL、SQLite、JS 谓词下命中集合相同', async () => {
    const user = `parity-${Date.now()}`;
    await mysqlStorage.setPlayRecords(user, CASES);
    await sqliteStorage.setPlayRecords(user, CASES);

    const [mysqlPage, sqlitePage] = await Promise.all([
      mysqlStorage.getUnreadTrackingPlayRecordPage(user, 50),
      sqliteStorage.getUnreadTrackingPlayRecordPage(user, 50),
    ]);
    const jsHits = Object.entries(CASES)
      .filter(([, record]) => hasPlayRecordUpdate(record))
      .map(([key]) => key)
      .sort();

    expect(Object.keys(mysqlPage.items).sort()).toEqual(jsHits);
    expect(Object.keys(sqlitePage.items).sort()).toEqual(jsHits);
    expect(mysqlPage.total).toBe(sqlitePage.total);
    expect(mysqlPage.total).toBe(jsHits.length);
  });

  it('同一批记录在两个后端的排序与游标翻页结果相同', async () => {
    const user = `parity-order-${Date.now()}`;
    await mysqlStorage.setPlayRecords(user, CASES);
    await sqliteStorage.setPlayRecords(user, CASES);

    const readAll = async (
      storage: MySqlStorage | LocalSqliteStorage,
    ): Promise<string[]> => {
      const collected: string[] = [];
      let cursor: string | null = null;
      do {
        const [cursorTime, cursorKey] = (cursor ?? '').split('|');
        const page: Awaited<
          ReturnType<typeof storage.getUnreadTrackingPlayRecordPage>
        > = await storage.getUnreadTrackingPlayRecordPage(
          user,
          2,
          cursor ? Number(cursorTime) : undefined,
          cursor ? cursorKey : undefined,
        );
        collected.push(...Object.keys(page.items));
        cursor = page.nextCursor;
      } while (cursor);
      return collected;
    };

    const [mysqlOrder, sqliteOrder] = await Promise.all([
      readAll(mysqlStorage),
      readAll(sqliteStorage),
    ]);

    expect(mysqlOrder).toEqual(sqliteOrder);
    expect(mysqlOrder.length).toBeGreaterThan(2);
  });
});
