/** @jest-environment node */

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { LocalSqliteStorage } from '../sqlite.db';
import type { PlayRecord } from '../types';

function makeRecord(overrides: Partial<PlayRecord> = {}): PlayRecord {
  return {
    title: '番剧A',
    source_name: '源A',
    year: '2024',
    cover: '',
    index: 1,
    total_episodes: 12,
    play_time: 60,
    total_time: 1500,
    save_time: 1000,
    ...overrides,
  };
}

describe('SQLite 遗留用户名大小写归一化', () => {
  let dir: string;
  let dbPath: string;
  let opened: LocalSqliteStorage[];

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'icetv-username-'));
    dbPath = path.join(dir, 'icetv-data.sqlite');
    opened = [];
  });

  // Windows 下未关闭的连接会锁住临时目录
  afterEach(() => {
    for (const storage of opened) {
      (storage as unknown as { db: Database.Database }).db.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function openStorage(): LocalSqliteStorage {
    const storage = new LocalSqliteStorage(dbPath);
    opened.push(storage);
    return storage;
  }

  function seed(run: (db: Database.Database) => void): void {
    openStorage();
    const db = new Database(dbPath);
    run(db);
    db.close();
  }

  it('迁移后遗留大写用户名的播放记录可被读取', async () => {
    seed((db) => {
      db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(
        'TAT',
        'hashed',
      );
      db.prepare(
        'INSERT INTO play_records (username, record_key, record_json) VALUES (?, ?, ?)',
      ).run('TAT', 'bfzy+116846', JSON.stringify(makeRecord()));
    });

    const migrated = openStorage();
    expect(await migrated.getAllUsers()).toEqual(['tat']);

    const records = await migrated.getAllPlayRecords('TAT');
    expect(Object.keys(records)).toEqual(['bfzy+116846']);
    expect(records['bfzy+116846'].title).toBe('番剧A');
  });

  it('规范行与遗留行冲突时保留 save_time 更新的记录并保留规范密码', async () => {
    seed((db) => {
      const insertUser = db.prepare(
        'INSERT INTO users (username, password) VALUES (?, ?)',
      );
      insertUser.run('TAT', 'legacy-password');
      insertUser.run('tat', 'canonical-password');

      const insertRecord = db.prepare(
        'INSERT INTO play_records (username, record_key, record_json) VALUES (?, ?, ?)',
      );
      insertRecord.run(
        'TAT',
        'bfzy+1',
        JSON.stringify(makeRecord({ index: 9, save_time: 5000 })),
      );
      insertRecord.run(
        'tat',
        'bfzy+1',
        JSON.stringify(makeRecord({ index: 3, save_time: 1000 })),
      );
      insertRecord.run(
        'TAT',
        'bfzy+2',
        JSON.stringify(makeRecord({ index: 4, save_time: 2000 })),
      );
    });

    const migrated = openStorage();
    const passwords = await migrated.getAllUsersWithPasswords();
    expect(passwords).toEqual({ tat: 'canonical-password' });

    const records = await migrated.getAllPlayRecords('tat');
    expect(Object.keys(records).sort()).toEqual(['bfzy+1', 'bfzy+2']);
    expect(records['bfzy+1'].index).toBe(9);
    expect(records['bfzy+2'].index).toBe(4);
  });

  it('搜索历史合并后规范用户关键词在前且去重', async () => {
    seed((db) => {
      const insert = db.prepare(
        'INSERT INTO search_history (username, keyword, sort_index) VALUES (?, ?, ?)',
      );
      insert.run('tat', '规范词', 0);
      insert.run('TAT', '规范词', 0);
      insert.run('TAT', '遗留词', 1);
    });

    const migrated = openStorage();
    expect(await migrated.getSearchHistory('tat')).toEqual([
      '规范词',
      '遗留词',
    ]);
  });

  it('迁移是幂等的，重复启动不会重复处理', async () => {
    seed((db) => {
      db.prepare(
        'INSERT INTO play_records (username, record_key, record_json) VALUES (?, ?, ?)',
      ).run('TAT', 'bfzy+1', JSON.stringify(makeRecord()));
    });

    const first = openStorage();
    expect(Object.keys(await first.getAllPlayRecords('tat'))).toEqual([
      'bfzy+1',
    ]);

    const second = openStorage();
    expect(Object.keys(await second.getAllPlayRecords('tat'))).toEqual([
      'bfzy+1',
    ]);

    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare('SELECT DISTINCT username FROM play_records')
      .all() as { username: string }[];
    db.close();
    expect(rows.map((row) => row.username)).toEqual(['tat']);
  });
});
