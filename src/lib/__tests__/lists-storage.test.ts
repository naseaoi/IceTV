/** @jest-environment node */
import type Database from 'better-sqlite3';

import { LocalSqliteStorage } from '@/lib/sqlite.db';

import { listsContract } from './__fixtures__/lists-contract';

describe('SQLite 片单契约', () => {
  const opened: LocalSqliteStorage[] = [];
  listsContract(() => {
    const storage = new LocalSqliteStorage(':memory:');
    opened.push(storage);
    return storage;
  });
  afterEach(() => {
    for (const storage of opened.splice(0))
      (storage as unknown as { db: Database.Database }).db.close();
  });
});

it('收藏按时间和 ID 稳定排序，上限计数与失效行一致', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const internal = storage as unknown as {
    db: Database.Database;
  };
  try {
    await storage.ensureUserProfile('bobby');
    const insert = internal.db.prepare(
      'INSERT INTO list_likes (list_id, username, created_at, list_name) VALUES (?, ?, ?, ?)',
    );
    internal.db.transaction(() => {
      for (let i = 0; i < 502; i++)
        insert.run(
          String(i).padStart(36, '0'),
          'bobby',
          Math.floor(i / 2),
          `名称${i}`,
        );
    })();
    const saved = await storage.getSavedLists('bobby');
    expect(saved).toHaveLength(500);
    expect(await storage.countSavedLists('bobby')).toBe(saved.length);
    expect(saved[0]).toEqual({
      status: 'deleted',
      id: String(500).padStart(36, '0'),
      name: '名称500',
      savedAt: 250,
    });
    expect(saved[1].id).toBe(String(501).padStart(36, '0'));
    await storage.deleteUser('bobby');
    expect(
      internal.db.prepare('SELECT COUNT(*) AS total FROM list_likes').get(),
    ).toEqual({ total: 0 });
  } finally {
    internal.db.close();
  }
});
