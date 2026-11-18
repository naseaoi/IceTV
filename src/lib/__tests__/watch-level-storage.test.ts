/** @jest-environment node */
import type Database from 'better-sqlite3';

import {
  assertWatchLevelContract,
  watchLevelSession as session,
} from '@/lib/__tests__/__fixtures__/watch-level-contract';
import { LocalSqliteStorage } from '@/lib/sqlite.db';

function internal(storage: LocalSqliteStorage) {
  return storage as unknown as {
    db: Database.Database;
    migrateWatchLevel(): void;
    migrateLegacyUsernameCasing(): void;
  };
}

it('SQLite 观影等级存储契约', async () => {
  await assertWatchLevelContract(new LocalSqliteStorage(':memory:'));
});

it('回填混合时间序列、桶封顶与升级作品，完成标记幂等', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const impl = internal(storage);
  await storage.setPlaybackSession('alice', {
    ...session,
    id: 'old-a',
    watch_seconds: 6300,
    started_at: 0,
    title: '旧口径',
  });
  await storage.saveWatchSessionReport(
    'alice',
    { ...session, id: 'bucket-a', title: '升级作品', ended_at: 1800001 },
    [{ start: 900000, watch_ms: 800000 }],
  );
  await storage.saveWatchSessionReport(
    'alice',
    { ...session, id: 'bucket-b' },
    [{ start: 900000, watch_ms: 800000 }],
  );
  await storage.setPlaybackSession('alice', {
    ...session,
    id: 'old-b',
    watch_seconds: 64800,
    started_at: 2000000,
    ended_at: 3000000,
    title: '中排作品',
  });
  impl.db.exec(
    "DELETE FROM user_watch_totals; DELETE FROM user_level_events; DELETE FROM storage_migrations WHERE name = 'watch_level_v1'",
  );
  impl.db.exec(
    "CREATE TRIGGER fail_level BEFORE INSERT ON user_level_events BEGIN SELECT RAISE(ABORT, 'interrupt'); END",
  );
  expect(() => impl.migrateWatchLevel()).toThrow('interrupt');
  expect((await storage.getWatchLevel('alice')).countedMs).toBe(0);
  expect(
    impl.db
      .prepare("SELECT 1 FROM storage_migrations WHERE name = 'watch_level_v1'")
      .get(),
  ).toBeUndefined();
  impl.db.exec('DROP TRIGGER fail_level');
  impl.migrateWatchLevel();
  const result = await storage.getWatchLevel('alice');
  expect(result.countedMs).toBe(72000000);
  expect(result.events).toEqual([
    expect.objectContaining({
      level: 2,
      title: '升级作品',
      reachedAt: 1800000,
    }),
    expect.objectContaining({
      level: 3,
      title: '中排作品',
      reachedAt: 3000000,
    }),
  ]);
  await storage.deletePlaybackSessionsBefore(Number.MAX_SAFE_INTEGER);
  impl.migrateWatchLevel();
  expect(await storage.getWatchLevel('alice')).toEqual(result);
});

it('大小写合并时累计相加，同级保留更早作品，并发现仅有等级数据的账号', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const impl = internal(storage);
  impl.db.exec(
    "INSERT INTO user_watch_totals VALUES ('alice', 7200000, 200), ('Alice', 7200000, 100), ('LevelOnly', 1000, 1)",
  );
  const insert = impl.db.prepare(
    'INSERT INTO user_level_events VALUES (?, 2, ?, ?, ?, ?, ?, ?)',
  );
  insert.run('alice', 200, 'source', 'video', '较晚', '2026', 2);
  insert.run('Alice', 100, 'source', 'video', '较早', '2026', 1);
  impl.migrateLegacyUsernameCasing();
  expect(await storage.getWatchLevel('alice')).toMatchObject({
    countedMs: 14400000,
    events: [{ title: '较早', reachedAt: 100 }],
  });
  expect((await storage.getWatchLevel('levelonly')).countedMs).toBe(1000);
});
