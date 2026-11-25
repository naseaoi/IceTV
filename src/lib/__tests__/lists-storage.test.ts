/** @jest-environment node */
import type Database from 'better-sqlite3';

import { LocalSqliteStorage } from '@/lib/sqlite.db';

import { listItem, listsContract } from './__fixtures__/lists-contract';

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
it('旧收藏名幂等回填，私密改名后重新迁移保持快照', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const internal = storage as unknown as {
    db: Database.Database;
    migrateListSchema(): void;
  };
  try {
    await storage.ensureUserProfile('alice');
    await storage.ensureUserProfile('bobby');
    const list = await storage.createList('alice', {
      name: '旧公开名称',
      visibility: 'members',
    });
    await storage.setListLike('bobby', list.id, true);
    internal.db.exec('ALTER TABLE list_likes DROP COLUMN list_name');
    internal.migrateListSchema();
    expect(
      internal.db.prepare('SELECT list_name FROM list_likes').get(),
    ).toEqual({ list_name: '旧公开名称' });
    await storage.updateList('alice', list.id, {
      name: '秘密',
      visibility: 'private',
    });
    internal.migrateListSchema();
    expect((await storage.getSavedLists('bobby'))[0]).toMatchObject({
      status: 'private',
      name: '旧公开名称',
    });
  } finally {
    internal.db.close();
  }
});

it('收藏按时间和 ID 稳定排序，上限计数与失效行一致', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const internal = storage as unknown as {
    db: Database.Database;
    migrateLegacyUsernameCasing(): void;
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
          'BOBBY',
          Math.floor(i / 2),
          `名称${i}`,
        );
    })();
    internal.migrateLegacyUsernameCasing();
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

it('大小写合并保留所有片单及条目，删号清除两表', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const internal = storage as unknown as {
    db: Database.Database;
    migrateLegacyUsernameCasing(): void;
  };
  try {
    await storage.ensureUserProfile('alice');
    const first = await storage.createList('alice', {
      name: '规范',
      item: listItem,
    });
    const legacy = await storage.createList('alice', {
      name: '遗留',
      item: listItem,
    });
    internal.db
      .prepare('UPDATE user_lists SET username = ? WHERE id = ?')
      .run('ALICE', legacy.id);
    internal.migrateLegacyUsernameCasing();
    expect(await storage.countUserLists('alice')).toBe(2);
    expect((await storage.getList(legacy.id, 'alice')).items).toHaveLength(1);
    expect((await storage.getList(first.id, 'alice')).items).toHaveLength(1);
    await storage.deleteUser('alice');
    expect(
      internal.db
        .prepare('SELECT COUNT(*) AS total FROM user_list_items')
        .get(),
    ).toEqual({ total: 0 });
  } finally {
    internal.db.close();
  }
});
it('大小写合并去重收藏并重算计数，删除片单保留收藏行', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const internal = storage as unknown as {
    db: Database.Database;
    migrateLegacyUsernameCasing(): void;
  };
  try {
    await storage.ensureUserProfile('alice');
    await storage.ensureUserProfile('bobby');
    const list = await storage.createList('alice', {
      name: '合并',
      visibility: 'everyone',
    });
    await storage.setListLike('bobby', list.id, true);
    internal.db
      .prepare(
        'INSERT INTO list_likes (list_id, username, created_at) VALUES (?, ?, ?)',
      )
      .run(list.id, 'BOBBY', Date.now());
    internal.db
      .prepare('UPDATE user_lists SET like_count = 2 WHERE id = ?')
      .run(list.id);
    internal.migrateLegacyUsernameCasing();
    expect((await storage.getList(list.id, 'bobby')).list).toEqual({
      ...list,
      likeCount: 1,
    });
    expect(
      internal.db.prepare('SELECT username FROM list_likes').all(),
    ).toEqual([{ username: 'bobby' }]);
    await storage.deleteList('alice', list.id);
    expect(
      (await storage.getAnnualActivity('alice', 0, Date.now() + 1000)).likes,
    ).toEqual([]);
    expect(
      internal.db.prepare('SELECT COUNT(*) AS total FROM list_likes').get(),
    ).toEqual({ total: 1 });
    expect(await storage.getSavedLists('bobby')).toEqual([
      {
        status: 'deleted',
        id: list.id,
        name: '合并',
        savedAt: expect.any(Number),
      },
    ]);
  } finally {
    internal.db.close();
  }
});
