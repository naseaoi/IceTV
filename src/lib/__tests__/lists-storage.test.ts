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
