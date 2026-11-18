/** @jest-environment node */
import type Database from 'better-sqlite3';

import { LocalSqliteStorage } from '@/lib/sqlite.db';
import type { PlaybackSession, PlayRecord } from '@/lib/types';

const session: PlaybackSession = {
  id: 'legacy-session-a',
  source: 'source',
  video_id: 'video',
  title: '作品',
  source_name: '源',
  cover: 'cover',
  year: '2026',
  episode_index: 1,
  started_at: 100,
  ended_at: 200,
  watch_seconds: 10,
  last_position: 10,
  total_time: 100,
  created_at: 100,
  updated_at: 200,
};
function internal(storage: LocalSqliteStorage) {
  return storage as unknown as {
    db: Database.Database;
    migrateWatchHistory(): void;
    migrateLegacyUsernameCasing(): void;
  };
}
it('一次性迁移最新位置、最早观看与分组，完成后重跑保持用户删除', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const impl = internal(storage);
  await storage.setPlaybackSession('alice', session);
  await storage.setPlaybackSession('alice', {
    ...session,
    id: 'legacy-session-z',
    started_at: 150,
    episode_index: 2,
    last_position: 40,
  });
  await storage.setPlaybackSession('alice', {
    ...session,
    id: 'legacy-zero',
    video_id: 'zero',
    watch_seconds: 0,
  });
  await storage.setPlayRecord('alice', 'source+video', {
    title: '作品',
    source_name: '源',
    cover: '',
    year: '',
    index: 2,
    total_episodes: 24,
    group_label: '第二季',
    group_index: 2,
    group_total: 12,
    play_time: 40,
    total_time: 100,
    save_time: 200,
  } as PlayRecord);
  impl.db
    .prepare('DELETE FROM storage_migrations WHERE name = ?')
    .run('watch_history_v1');
  impl.migrateWatchHistory();
  const rows = await storage.getWatchHistoryPage('alice', { limit: 10 });
  expect(rows).toEqual([
    expect.objectContaining({
      episode_index: 2,
      position: 40,
      first_watched_at: 100,
      last_watched_at: 200,
      total_episodes: 24,
      group_label: '第二季',
    }),
  ]);
  await storage.deleteWatchHistoryEntry('alice', rows[0].id);
  impl.migrateWatchHistory();
  expect(await storage.getWatchHistoryPage('alice', { limit: 10 })).toEqual([]);
});
it('迁移中断整体回滚，重试完整回填', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const impl = internal(storage);
  await storage.setPlaybackSession('alice', session);
  impl.db
    .prepare('DELETE FROM storage_migrations WHERE name = ?')
    .run('watch_history_v1');
  impl.db.exec(
    "CREATE TRIGGER interrupt_migration BEFORE INSERT ON storage_migrations BEGIN SELECT RAISE(ABORT, 'interrupt'); END;",
  );
  expect(() => impl.migrateWatchHistory()).toThrow('interrupt');
  expect(await storage.getWatchHistoryPage('alice', { limit: 10 })).toEqual([]);
  impl.db.exec('DROP TRIGGER interrupt_migration');
  impl.migrateWatchHistory();
  expect(
    await storage.getWatchHistoryPage('alice', { limit: 10 }),
  ).toHaveLength(1);
});
it('大小写合并保留较新历史并迁移仅存在新表中的用户', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const impl = internal(storage);
  const { historyId: id } = await storage.saveWatchSessionReport(
    'alice',
    session,
    [{ start: 0, watch_ms: 1000 }],
    { total_episodes: 2 },
  );
  const { historyId: old } = await storage.saveWatchSessionReport(
    'legacy',
    { ...session, id: 'legacy-session-b', last_position: 70, updated_at: 300 },
    [{ start: 0, watch_ms: 2000 }],
    { total_episodes: 2 },
  );
  for (const table of [
    'watch_history',
    'playback_watch_buckets',
    'playback_sessions',
  ])
    impl.db
      .prepare(`UPDATE ${table} SET username = ? WHERE username = ?`)
      .run('Alice', 'legacy');
  impl.migrateLegacyUsernameCasing();
  expect(await storage.getWatchHistoryPage('alice', { limit: 10 })).toEqual([
    expect.objectContaining({ id: old, position: 70 }),
  ]);
  expect(old).not.toBe(id);
  expect(
    impl.db
      .prepare('SELECT DISTINCT username FROM playback_watch_buckets')
      .all(),
  ).toEqual([{ username: 'alice' }]);
  impl.db.prepare('UPDATE watch_history SET username = ?').run('HistoryOnly');
  impl.migrateLegacyUsernameCasing();
  expect(
    await storage.getWatchHistoryPage('historyonly', { limit: 10 }),
  ).toHaveLength(1);
});
it('写历史失败时会话和时间桶同时回滚', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const impl = internal(storage);
  impl.db.exec(
    "CREATE TRIGGER interrupt_history BEFORE INSERT ON watch_history BEGIN SELECT RAISE(ABORT, 'interrupt'); END;",
  );
  await expect(
    storage.saveWatchSessionReport(
      'alice',
      session,
      [{ start: 0, watch_ms: 1000 }],
      { total_episodes: 2 },
    ),
  ).rejects.toMatchObject({ message: 'interrupt' });
  expect(impl.db.prepare('SELECT * FROM playback_sessions').all()).toEqual([]);
  expect(impl.db.prepare('SELECT * FROM playback_watch_buckets').all()).toEqual(
    [],
  );
});
