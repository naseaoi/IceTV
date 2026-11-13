/** @jest-environment node */
import type Database from 'better-sqlite3';
import type { Pool } from 'mysql2/promise';

import { resetMysqlTestData } from '@/lib/__tests__/__fixtures__/mysql-test-data';
import { MySqlStorage } from '@/lib/mysql.db';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import type { IStorage } from '@/lib/types';

const liveUrl = process.env.MYSQL_TEST_URL?.trim();
for (const dialect of ['sqlite', 'mysql'] as const) {
  (dialect === 'sqlite' || liveUrl ? describe : describe.skip)(
    `${dialect} annual activity storage`,
    () => {
      let storage: IStorage;
      let execute: (
        sql: string,
        params: (string | number | null)[],
      ) => Promise<void>;
      let close: () => Promise<void>;
      beforeEach(async () => {
        if (dialect === 'sqlite') {
          const local = new LocalSqliteStorage(':memory:');
          const sql = (local as unknown as { db: Database.Database }).db;
          storage = local;
          execute = async (query, params) => {
            sql.prepare(query).run(...params);
          };
          close = async () => {
            sql.close();
          };
        } else {
          const mysql = new MySqlStorage(liveUrl);
          await resetMysqlTestData(mysql);
          const pool = (mysql as unknown as { pool: Pool }).pool;
          storage = mysql;
          execute = async (query, params) => {
            await pool.execute(query, params);
          };
          close = async () => {
            await pool.end();
          };
        }
      });
      afterEach(async () => close());
      it('isolates users and half-open time ranges while retaining old completion watches and first three list covers', async () => {
        const start = Date.parse('2025-01-01T00:00:00Z');
        const end = Date.parse('2026-01-01T00:00:00Z');
        for (const username of ['alice', 'other']) {
          for (const [i, time] of [start - 1, start, end - 1, end].entries()) {
            await execute(
              'INSERT INTO work_completions (username, title_norm, year, celebrated_at) VALUES (?, ?, ?, ?)',
              [username, `work${i}`, '', time],
            );
            await execute(
              'INSERT INTO user_follows (follower, followee, created_at) VALUES (?, ?, ?)',
              [username, `target${i}`, time],
            );
            await execute(
              'INSERT INTO time_capsules (id, username, title, title_norm, year, cover, source, video_id, content, rating_then, created_at, deliver_at, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
              [
                `${username}${i}`,
                username,
                `work${i}`,
                `work${i}`,
                '',
                '',
                '',
                '',
                'private body',
                8,
                time,
                time + 1,
              ],
            );
          }
          for (const [i, title] of ['Work.1', 'Café', 'Cafe'].entries()) {
            await storage.setPlaybackSession(username, {
              id: `${username}${i}`,
              source: 'a',
              video_id: `${i}`,
              title,
              year: '',
              cover: 'cover',
              source_name: 'a',
              episode_index: 1,
              started_at: start - 10000,
              ended_at: start - 9000,
              watch_seconds: 1,
              last_position: 1,
              total_time: 1,
              created_at: start - 10000,
              updated_at: start - 9000,
            });
          }
          await execute(
            'INSERT INTO user_lists (id, username, name, description, is_public, item_count, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [username, username, username, '', 2, 5, 1, start - 1, start],
          );
          for (let i = 0; i < 5; i++) {
            await execute(
              'INSERT INTO user_list_items (id, list_id, title, title_norm, year, cover, source, source_id, search_title, position, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [
                `${username}-${i}`,
                username,
                `${i}`,
                `${i}`,
                '',
                `cover${i}`,
                '',
                null,
                '',
                i,
                i < 3 ? start - 1 : i === 3 ? start : end,
              ],
            );
          }
          for (const [i, time] of [start - 1, start, end - 1, end].entries()) {
            await execute(
              'INSERT INTO list_likes (list_id, username, created_at) VALUES (?, ?, ?)',
              [username, `liker${i}`, time],
            );
          }
        }
        const result = await storage.getAnnualActivity('ALICE', start, end);
        expect(
          result.completions.map((row) => row.celebratedAt).sort(),
        ).toEqual([start, end - 1].sort());
        expect(result.completionWatches).toHaveLength(3);
        expect(result.completionWatches.map((row) => row.title)).toEqual(
          expect.arrayContaining(['Cafe', 'Café']),
        );
        expect(
          result.completionWatches.every(
            (row) => row.firstAt === start - 10000,
          ),
        ).toBe(true);
        expect(result.lists).toHaveLength(1);
        expect(result.lists[0].id).toBe('alice');
        expect(result.listItems.map((row) => row.position).sort()).toEqual([
          0, 1, 2, 3,
        ]);
        expect(result.likes).toHaveLength(2);
        expect(result.capsules).toHaveLength(3);
        expect(JSON.stringify(result.capsules)).not.toContain('private body');
        expect(result.capsules.every((row) => !('content' in row))).toBe(true);
        expect(result.follows).toHaveLength(2);
      });
    },
  );
}
