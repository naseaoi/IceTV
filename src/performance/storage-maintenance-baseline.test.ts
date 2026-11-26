/** @jest-environment node */
import type Database from 'better-sqlite3';

import { sourceUsageSql } from '@/features/playback-stats/lib/source-usage';
import {
  type PlaybackSourceUsageRow,
  aggregateSourceUsage,
} from '@/lib/__tests__/__fixtures__/playback-maintenance-contract';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import type { AdminConfig } from '@/types/admin';

const benchmark =
  process.env.RUN_STORAGE_MAINTENANCE_BASELINE === '1' ? it : it.skip;
benchmark(
  'measures 270k playback sessions and 4000 permission recipients in isolated SQLite memory',
  async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const raw = (storage as unknown as { db: Database.Database }).db;
    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    try {
      const insert = raw.prepare(`INSERT INTO playback_sessions
      (id, username, source, video_id, episode_index, title, source_name, cover, year, started_at, ended_at, watch_seconds, last_position, total_time, created_at, updated_at)
      VALUES (?, ?, ?, 'v', 1, ?, 'Source', '', '2026', ?, ?, 60, 60, 100, ?, ?)`);
      raw.transaction(() => {
        for (let index = 0; index < 270000; index++)
          insert.run(
            `session-${index}`,
            `user-${index % 4000}`,
            `source-${index % 30}`,
            `Work ${Math.floor(index / 30) % 100}`,
            index,
            index + 60,
            index,
            index + 60,
          );
      })();
      const oldSql =
        'SELECT username, source, source_name, title, year, watch_seconds, started_at FROM playback_sessions WHERE started_at >= ? AND started_at < ? AND watch_seconds > 0';
      const oldTimes: number[] = [];
      const newTimes: number[] = [];
      for (let round = 0; round < 5; round++) {
        let start = performance.now();
        const old = aggregateSourceUsage(
          raw.prepare(oldSql).all(0, 270000) as PlaybackSourceUsageRow[],
        );
        const oldTime = performance.now() - start;
        start = performance.now();
        const next = await storage.getPlaybackSourceUsage(0, 270000);
        const newTime = performance.now() - start;
        expect(next).toEqual(old);
        if (round) {
          oldTimes.push(oldTime);
          newTimes.push(newTime);
        }
      }
      const rowsReturned = raw
        .prepare(sourceUsageSql(false, 'sqlite'))
        .all(0, 270000).length;
      const before = {
        SourceConfig: Array.from({ length: 50 }, (_, index) => ({
          key: `source-${index}`,
        })),
        UserConfig: { Tags: [] },
      } as unknown as AdminConfig;
      const after = {
        ...before,
        SourceConfig: before.SourceConfig.map((source, index) => ({
          ...source,
          disabled: index === 49,
        })),
      } as AdminConfig;
      const addUser = raw.prepare(
        'INSERT INTO users (username, password) VALUES (?, ?)',
      );
      const addAccess = raw.prepare(
        "INSERT INTO user_access (username, role, banned, updated_at) VALUES (?, 'user', 0, 0)",
      );
      raw.transaction(() => {
        for (let index = 0; index < 4000; index++) {
          addUser.run(`user-${index}`, 'unused');
          addAccess.run(`user-${index}`);
        }
      })();
      const noticeTimes: number[] = [];
      const prepares: number[] = [];
      const reads: number[] = [];
      for (let round = 0; round < 5; round++) {
        await storage.setAdminConfig(before);
        raw.exec('DELETE FROM user_notice_events');
        const spy = jest.spyOn(raw, 'prepare');
        const start = performance.now();
        await storage.compareAndSetAdminConfig(before, after);
        const elapsed = performance.now() - start;
        const count = spy.mock.calls.length;
        const readCount = spy.mock.calls.filter(([sql]) =>
          sql.startsWith('SELECT'),
        ).length;
        spy.mockRestore();
        expect(
          raw.prepare('SELECT COUNT(*) AS count FROM user_notice_events').get(),
        ).toEqual({ count: 4000 });
        if (round) {
          noticeTimes.push(elapsed);
          prepares.push(count);
          reads.push(readCount);
        }
      }
      console.log(
        JSON.stringify({
          node: process.version,
          sessionCount: 270000,
          returnedRows: rowsReturned,
          sourceUsageOldMs: oldTimes,
          sourceUsageNewMs: newTimes,
          sourceUsageOldMedianMs: median(oldTimes),
          sourceUsageNewMedianMs: median(newTimes),
          users: 4000,
          permissionSourceCount: before.SourceConfig.length,
          permissionMs: noticeTimes,
          permissionMedianMs: median(noticeTimes),
          permissionPrepareCount: prepares,
          permissionReadCount: reads,
          note: 'SQLite :memory:, five runs with first warmup discarded; permission count excludes precompiled config read/write statements',
        }),
      );
    } finally {
      raw.close();
    }
  },
  120000,
);
