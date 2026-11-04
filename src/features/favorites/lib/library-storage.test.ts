/** @jest-environment node */

import Database from 'better-sqlite3';

import {
  type FavoriteSort,
  buildFavoriteLibrary,
  selectFavoriteEntries,
} from '@/features/favorites/lib/favorite-library';
import type { FavoriteLibraryPage } from '@/features/favorites/lib/library-query';
import {
  favoriteProjection,
  libraryStatements,
} from '@/features/favorites/lib/library-storage';
import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';
import { MySqlStorage } from '@/lib/mysql.db';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import type {
  Favorite,
  IStorage,
  PlayRecord,
  StorageImportData,
  VideoReview,
} from '@/lib/types';

const favorite: Favorite = {
  title: 'Demo',
  source_name: 'source',
  cover: '',
  total_episodes: 10,
  save_time: 1000,
  year: '2026',
};
const query = { query: '', filter: 'all', sort: 'saved' } as const;
const liveUrl = process.env.MYSQL_TEST_URL?.trim();

type InternalSqlite = {
  db: Database.Database;
  backfillFavoriteProjection(): void;
  migrateFavoriteProjection(): void;
  migrateLegacyUsernameCasing(): void;
};

for (const backend of ['sqlite', 'mysql'] as const) {
  const suite = backend === 'mysql' && !liveUrl ? describe.skip : describe;
  suite(`${backend} favorite library`, () => {
    let storage: IStorage;
    const username = `favorite-library-${backend}`;
    beforeAll(() => {
      storage =
        backend === 'sqlite'
          ? new LocalSqliteStorage(':memory:')
          : new MySqlStorage(liveUrl!);
    });
    beforeEach(async () => {
      await storage.deleteUser(username);
    });
    afterAll(async () => {
      await storage.deleteUser(username);
      if (backend === 'mysql')
        await (
          storage as unknown as { pool: { end(): Promise<void> } }
        ).pool.end();
      else (storage as unknown as InternalSqlite).db.close();
    });

    it('matches in-memory semantics for all sorts and filters over tied cursor pages', async () => {
      const favorites: Record<string, Favorite> = {};
      const records: Record<string, PlayRecord> = {};
      const reviews: VideoReview[] = [];
      for (let i = 0; i < 117; i++) {
        const key = `source+${String(i).padStart(3, '0')}`;
        favorites[key] = {
          ...favorite,
          title: `Ｄｅｍｏ ${i}`,
          search_title: i % 3 ? '别名' : '其他',
          year: i % 4 ? '2026' : 'unknown',
          save_time: 1000 + (i % 5),
        };
        await storage.setFavorite(username, key, favorites[key]);
        if (i % 3 !== 0) {
          records[key] = {
            ...favorites[key],
            index: 2,
            play_time: 20,
            total_time: 100,
            save_time: 2000 + (i % 7),
          };
          await storage.setPlayRecord(username, key, records[key]);
        }
        if (i % 2 === 0) {
          const review = {
            ...videoReview,
            title_norm: `demo${i}`,
            year: '',
            rating: i % 6 ? 8 : null,
            is_public: false,
          };
          reviews.push(review);
          await storage.setVideoReview(username, review);
          if (i % 4) {
            const exact = { ...review, year: '2026', rating: null };
            reviews.push(exact);
            await storage.setVideoReview(username, exact);
          }
        }
      }
      const entries = buildFavoriteLibrary(favorites, records, reviews);
      for (const sort of [
        'saved',
        'played',
        'rating',
        'year',
      ] as FavoriteSort[]) {
        for (const filter of [
          'all',
          'watched',
          'unwatched',
          'reviewed',
        ] as const) {
          const options = { query: '', filter, sort };
          const result: FavoriteLibraryPage['items'] = [];
          let cursor: string | null = null;
          do {
            const page: FavoriteLibraryPage =
              await storage.getFavoriteLibraryPage(username, {
                ...options,
                cursor,
              });
            expect(page.counts).toEqual({
              all: 117,
              watched: 78,
              unwatched: 39,
              reviewed: 59,
            });
            result.push(...page.items);
            cursor = page.nextCursor;
          } while (cursor);
          const expected = selectFavoriteEntries(entries, options);
          // 旧内存排序没有唯一键兜底，比较各排序分组后显式加相同的二进制 key 次序。
          const value = (key: string): number | null =>
            sort === 'saved'
              ? favorites[key].save_time
              : sort === 'played'
                ? (records[key]?.save_time ?? null)
                : sort === 'year'
                  ? favorites[key].year === 'unknown'
                    ? null
                    : 2026
                  : (expected.find(
                      (entry) => entry.item.id === key.split('+')[1],
                    )?.item.myRating ?? null);
          const keys = expected
            .map((entry) => `source+${entry.item.id}`)
            .sort((a, b) => {
              const av = value(a),
                bv = value(b);
              return (
                (av === null
                  ? bv === null
                    ? 0
                    : 1
                  : bv === null
                    ? -1
                    : bv - av) ||
                favorites[b].save_time - favorites[a].save_time ||
                (a < b ? 1 : a > b ? -1 : 0)
              );
            });
          expect(result.map((item) => item.key)).toEqual(keys);
          expect(new Set(result.map((item) => item.key)).size).toBe(
            keys.length,
          );
          for (const item of result) {
            expect(item.myRating).toBe(
              entries.find((entry) => entry.item.id === item.key.split('+')[1])
                ?.item.myRating ?? null,
            );
            expect(item.playRecord).toEqual(records[item.key]);
          }
        }
      }
      const search = await storage.getFavoriteLibraryPage(username, {
        ...query,
        query: '别 名',
        filter: 'reviewed',
      });
      expect(search.counts).toEqual({
        all: 78,
        watched: 78,
        unwatched: 0,
        reviewed: 39,
      });
      expect(search.total).toBe(39);
      expect(search.libraryTotal).toBe(117);
      const first = await storage.getFavoriteLibraryPage(username, query);
      for (const changed of [
        { query: 'other' },
        { sort: 'rating' as const },
        { filter: 'watched' as const },
      ]) {
        await expect(
          storage.getFavoriteLibraryPage(username, {
            ...query,
            ...changed,
            cursor: first.nextCursor,
          }),
        ).rejects.toThrow('游标');
      }
      await expect(
        storage.getFavoriteLibraryPage(username, { ...query, cursor: 'bad' }),
      ).rejects.toThrow('游标');
    });

    it('preserves literal search, exact-null review priority, wildcard, and conditional projection writes', async () => {
      await storage.setFavorite(username, 'source+1', {
        ...favorite,
        title: 'Ａ . B',
        search_title: '%test',
      });
      await storage.setFavorite(username, 'source+2', {
        ...favorite,
        title: 'Other',
        year: 'unknown',
      });
      await storage.setVideoReview(username, {
        ...videoReview,
        title_norm: 'ab',
        year: '',
        rating: 9,
      });
      await storage.setVideoReview(username, {
        ...videoReview,
        title_norm: 'ab',
        year: '2026',
        rating: null,
      });
      const page = await storage.getFavoriteLibraryPage(username, {
        ...query,
        query: '%',
      });
      expect(page.total).toBe(1);
      expect(page.items[0].myRating).toBeNull();
      expect(page.counts.reviewed).toBe(1);
      const original = await storage.getFavorite(username, 'source+1');
      const changed = { ...favorite, title: 'changed', save_time: 9000 };
      expect(
        await storage.setFavoriteIfUnchanged(
          username,
          'source+1',
          changed,
          'bad',
        ),
      ).toBe(false);
      expect(
        await storage.setFavoriteIfUnchanged(
          username,
          'source+1',
          changed,
          JSON.stringify(original),
        ),
      ).toBe(true);
      expect(
        (
          await storage.getFavoriteLibraryPage(username, {
            ...query,
            query: 'changed',
          })
        ).total,
      ).toBe(1);
      expect(
        (
          await storage.getFavoriteLibraryPage(username, {
            ...query,
            query: '%',
          })
        ).total,
      ).toBe(0);
      await storage.deleteUser(username);
      expect(
        (await storage.getFavoriteLibraryPage(username, query)).libraryTotal,
      ).toBe(0);
    });

    it('rebuilds projections through replace/import and clear paths', async () => {
      // 测试使用独立数据库；替换全库不会接触开发数据。
      const data = {
        users: { [username]: '' },
        userData: {
          [username]: {
            favorites: {
              'source+imported': { ...favorite, title: 'Imported' },
            },
            playRecords: {},
            searchHistory: [],
            skipConfigs: {},
            playbackSessions: {},
          },
        },
        adminConfig: {},
        sourceRouteStats: [],
        inviteCodeUsage: {},
      } as unknown as StorageImportData;
      await storage.replaceAllData(data);
      const page = await storage.getFavoriteLibraryPage(username, {
        ...query,
        query: 'imported',
      });
      expect(page.total).toBe(1);
      await storage.deleteAllFavorites(username);
      expect(
        (await storage.getFavoriteLibraryPage(username, query)).total,
      ).toBe(0);
    });

    it('restarts projection backfill without overwriting a concurrent favorite edit', async () => {
      await storage.setFavorite(username, 'source+legacy', favorite);
      if (backend === 'sqlite') {
        const internal = storage as unknown as InternalSqlite;
        internal.db
          .prepare(
            'UPDATE favorites SET projection_version = 0, title_norm = NULL WHERE username = ?',
          )
          .run(username);
        internal.migrateFavoriteProjection();
        internal.backfillFavoriteProjection();
        internal.backfillFavoriteProjection();
        expect(
          (
            await storage.getFavoriteLibraryPage(username, {
              ...query,
              query: 'demo',
            })
          ).total,
        ).toBe(1);
      } else {
        const internal = storage as unknown as {
          migrateFavoriteProjection(): Promise<void>;
          pool: {
            execute(sql: string, params?: unknown[]): Promise<unknown>;
            query(
              sql: string,
              params?: unknown[],
            ): Promise<[Record<string, unknown>[], unknown]>;
          };
        };
        await internal.pool.execute(
          'UPDATE favorites SET projection_version = 0, title_norm = NULL WHERE username = ?',
          [username],
        );
        const execute = internal.pool.execute.bind(internal.pool);
        let interleaved = false;
        const spy = jest
          .spyOn(internal.pool, 'execute')
          .mockImplementation(async (sql, params) => {
            if (
              !interleaved &&
              sql.startsWith('UPDATE favorites SET title_norm')
            ) {
              interleaved = true;
              await storage.setFavorite(username, 'source+legacy', {
                ...favorite,
                title: 'Concurrent edit',
              });
            }
            return execute(sql, params);
          });
        try {
          await internal.migrateFavoriteProjection();
        } finally {
          spy.mockRestore();
        }
        await internal.migrateFavoriteProjection();
        expect(
          (
            await storage.getFavoriteLibraryPage(username, {
              ...query,
              query: 'concurrent',
            })
          ).total,
        ).toBe(1);
        const [rows] = await internal.pool.query(
          'SELECT projection_version FROM favorites WHERE username = ?',
          [username],
        );
        expect(rows[0].projection_version).toBe(1);
      }
    });

    it('uses user and join indexes in the actual query plan', async () => {
      for (let i = 0; i < 160; i++) {
        const title = `Plan ${i}`;
        await storage.setFavorite(username, `source+plan-${i}`, {
          ...favorite,
          title,
        });
        await storage.setPlayRecord(username, `source+plan-${i}`, {
          ...favorite,
          title,
          index: 1,
          play_time: 10,
          total_time: 100,
        });
        await storage.setVideoReview(username, {
          ...videoReview,
          title_norm: `plan${i}`,
        });
      }
      const sql = libraryStatements(backend, username, query);
      if (backend === 'sqlite') {
        const rows = (storage as unknown as InternalSqlite).db
          .prepare(`EXPLAIN QUERY PLAN ${sql.page}`)
          .all(...sql.pageParams);
        const plan = JSON.stringify(rows);
        expect(plan).toContain('INDEX');
        expect(plan).toContain('username=?');
        console.log('SQLite favorite library EXPLAIN', rows);
      } else {
        const [rows] = await (
          storage as unknown as {
            pool: {
              query(
                sql: string,
                params: unknown[],
              ): Promise<[unknown[], unknown]>;
            };
          }
        ).pool.query(`EXPLAIN ${sql.page}`, sql.pageParams);
        expect(rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              table: 'f',
              possible_keys: expect.stringContaining('idx_favorites_saved'),
            }),
          ]),
        );
        console.log('MySQL favorite library EXPLAIN', rows);
      }
    });
  });
}

describe('favorite projection backfill', () => {
  it('recomputes the winning JSON projection during username casing merge', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const internal = storage as unknown as InternalSqlite;
    try {
      await storage.setFavorite('alice', 'source+1', favorite);
      internal.db
        .prepare(
          'INSERT INTO favorites(username, favorite_key, favorite_json) VALUES (?, ?, ?)',
        )
        .run(
          'Alice',
          'source+1',
          JSON.stringify({ ...favorite, title: 'New Winner', save_time: 2000 }),
        );
      internal.migrateLegacyUsernameCasing();
      const result = await storage.getFavoriteLibraryPage('alice', {
        ...query,
        query: 'winner',
      });
      expect(result.total).toBe(1);
      expect(result.items[0].favorite.save_time).toBe(2000);
    } finally {
      internal.db.close();
    }
  });
  it('resumes batches, marks malformed rows, and is idempotent without changing JSON', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const internal = storage as unknown as InternalSqlite;
    try {
      const insert = internal.db.prepare(
        'INSERT INTO favorites(username, favorite_key, favorite_json) VALUES (?, ?, ?)',
      );
      for (let i = 0; i < 501; i++)
        insert.run('backfill', `source+${i}`, JSON.stringify(favorite));
      insert.run('backfill', 'bad-key', '{bad');
      internal.migrateFavoriteProjection();
      internal.backfillFavoriteProjection();
      internal.migrateFavoriteProjection();
      internal.backfillFavoriteProjection();
      expect(
        internal.db
          .prepare(
            'SELECT COUNT(*) AS count FROM favorites WHERE projection_version = 0',
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        (await storage.getFavoriteLibraryPage('backfill', query)).total,
      ).toBe(501);
      expect((await storage.getAllFavorites('backfill'))['source+0']).toEqual(
        favorite,
      );
      expect(
        favoriteProjection(
          'source+1',
          JSON.stringify({ ...favorite, year: 'unknown' }),
        )[2],
      ).toBeNull();
    } finally {
      internal.db.close();
    }
  });
});
