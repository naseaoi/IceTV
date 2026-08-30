/** @jest-environment node */

import { MySqlStorage } from '../mysql.db';
import type { PlayRecord } from '../types';

const liveUrl = (process.env.MYSQL_TEST_URL || '').trim();
const describeLive = liveUrl ? describe : describe.skip;

const basePlayRecord: PlayRecord = {
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

describeLive('MySQL 追更查询（真实实例）', () => {
  let storage: MySqlStorage;

  beforeAll(() => {
    storage = new MySqlStorage(liveUrl);
  });

  afterAll(async () => {
    await (
      storage as unknown as { pool: { end: () => Promise<void> } }
    ).pool.end();
  });

  const makeRecord = (
    total: number,
    baseline: number,
    detectedAt: number,
    extra: Partial<PlayRecord> = {},
  ): PlayRecord => ({
    ...basePlayRecord,
    index: 1,
    total_episodes: total,
    save_time: detectedAt,
    metadata_checked_at: detectedAt,
    update_baseline_episodes: baseline,
    tracking_enabled: true,
    ...extra,
  });

  it('只返回未读且未关闭追更的记录', async () => {
    const user = `live-basic-${Date.now()}`;
    await storage.setPlayRecords(user, {
      'source+new': makeRecord(12, 10, 30),
      'source+read': makeRecord(10, 10, 20),
      'source+disabled': makeRecord(20, 10, 40, { tracking_enabled: false }),
      'source+finished': makeRecord(12, 10, 50, { index: 12 }),
    });

    const page = await storage.getUnreadTrackingPlayRecordPage(user, 10);

    expect(page.total).toBe(1);
    expect(Object.keys(page.items)).toEqual(['source+new']);
    expect(page.nextCursor).toBeNull();
  });

  it('按检测时间倒序翻页，total 恒为总未读数', async () => {
    const user = `live-page-${Date.now()}`;
    await storage.setPlayRecords(user, {
      'source+a': makeRecord(12, 10, 10),
      'source+b': makeRecord(12, 10, 20),
      'source+c': makeRecord(12, 10, 30),
    });

    const first = await storage.getUnreadTrackingPlayRecordPage(user, 2);

    expect(first.total).toBe(3);
    expect(Object.keys(first.items)).toEqual(['source+c', 'source+b']);
    expect(first.nextCursor).not.toBeNull();

    const [cursorTime, cursorKey] = (first.nextCursor ?? '').split('|');
    const second = await storage.getUnreadTrackingPlayRecordPage(
      user,
      2,
      Number(cursorTime),
      cursorKey,
    );

    expect(second.total).toBe(3);
    expect(Object.keys(second.items)).toEqual(['source+a']);
    expect(second.nextCursor).toBeNull();
  });

  it('按分组刻度判定未读', async () => {
    const user = `live-group-${Date.now()}`;
    await storage.setPlayRecords(user, {
      'source+group-new': makeRecord(0, 0, 30, {
        group_index: 1,
        group_total: 4,
        update_baseline_group_total: 2,
        total_episodes: 99,
        update_baseline_episodes: 99,
      }),
      'source+group-read': makeRecord(0, 0, 20, {
        group_index: 2,
        group_total: 2,
        update_baseline_group_total: 2,
        total_episodes: 99,
        update_baseline_episodes: 1,
      }),
    });

    const page = await storage.getUnreadTrackingPlayRecordPage(user, 10);

    expect(page.total).toBe(1);
    expect(Object.keys(page.items)).toEqual(['source+group-new']);
  });

  it('缺字段与非数字字段不报错且不误判为未读', async () => {
    const user = `live-loose-${Date.now()}`;
    await storage.setPlayRecords(user, {
      'source+missing-baseline': {
        ...basePlayRecord,
        save_time: 10,
        total_episodes: 12,
        index: 1,
      },
      'source+null-total': {
        ...basePlayRecord,
        save_time: 20,
        index: 1,
        total_episodes: null as unknown as number,
      },
      'source+string-total': {
        ...basePlayRecord,
        save_time: 30,
        index: 1,
        total_episodes: 'abc' as unknown as number,
        update_baseline_episodes: 1,
      },
    });

    const page = await storage.getUnreadTrackingPlayRecordPage(user, 10);

    expect(page.total).toBe(0);
    expect(Object.keys(page.items)).toEqual([]);
  });

  it('tracking_enabled 缺失时按开启处理', async () => {
    const user = `live-default-${Date.now()}`;
    const record = makeRecord(12, 10, 30);
    delete record.tracking_enabled;
    await storage.setPlayRecords(user, { 'source+no-flag': record });

    const page = await storage.getUnreadTrackingPlayRecordPage(user, 10);

    expect(page.total).toBe(1);
    expect(Object.keys(page.items)).toEqual(['source+no-flag']);
  });
});
