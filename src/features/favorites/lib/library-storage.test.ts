/** @jest-environment node */

import Database from 'better-sqlite3';

import type { FavoriteSort } from '@/features/favorites/lib/favorite-library';
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
      const ratingFor = (key: string) => {
        const f = favorites[key];
        const title = `demo${Number(key.split('+')[1])}`;
        return (
          (
            reviews.find((r) => r.title_norm === title && r.year === f.year) ??
            reviews.find((r) => r.title_norm === title && r.year === '')
          )?.rating ?? null
        );
      };
      const statusFor = (key: string) =>
        ratingFor(key) !== null
          ? 'completed'
          : records[key]
            ? 'watching'
            : 'planned';
      for (const sort of [
        'saved',
        'played',
        'watched',
        'rating',
        'year',
      ] as FavoriteSort[]) {
        for (const filter of [
          'all',
          'planned',
          'watching',
          'completed',
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
              planned: 39,
              watching: 58,
              completed: 20,
              reviewed: 59,
            });
            result.push(...page.items);
            cursor = page.nextCursor;
          } while (cursor);
          const expected = Object.keys(favorites).filter(
            (key) =>
              filter === 'all' ||
              (filter === 'reviewed'
                ? Number(key.split('+')[1]) % 2 === 0
                : statusFor(key) === filter),
          );
          // 旧内存排序没有唯一键兜底，比较各排序分组后显式加相同的二进制 key 次序。
          const value = (key: string): number | null =>
            sort === 'saved'
              ? favorites[key].save_time
              : sort === 'played'
                ? (records[key]?.save_time ?? null)
                : sort === 'watched'
                  ? ratingFor(key) !== null
                    ? (records[key]?.save_time ?? videoReview.updated_at)
                    : null
                  : sort === 'year'
                    ? favorites[key].year === 'unknown'
                      ? null
                      : 2026
                    : ratingFor(key);
          const keys = expected.sort((a, b) => {
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
            expect(item.myRating).toBe(ratingFor(item.key));
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
        planned: 0,
        watching: 58,
        completed: 20,
        reviewed: 39,
      });
      expect(search.total).toBe(39);
      expect(search.libraryTotal).toBe(117);
      const first = await storage.getFavoriteLibraryPage(username, query);
      for (const changed of [
        { query: 'other' },
        { sort: 'rating' as const },
        { filter: 'watching' as const },
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
            'UPDATE favorites SET projection_version = 1, title_norm = NULL WHERE username = ?',
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
          'UPDATE favorites SET projection_version = 1, title_norm = NULL WHERE username = ?',
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
        expect(rows[0].projection_version).toBe(2);
      }
    });

    it('优先手动状态，按 1 基最后一集及组内进度推导完成', async () => {
      const scenarios = [
        {
          key: 'manual',
          status: 'planned' as const,
          index: 10,
          progress: 100,
          expected: 'planned',
        },
        { key: 'last', index: 10, progress: 90, expected: 'completed' },
        { key: 'before', index: 9, progress: 100, expected: 'watching' },
        { key: 'partial', index: 10, progress: 89, expected: 'watching' },
        {
          key: 'group',
          index: 5,
          groupIndex: 2,
          groupTotal: 2,
          progress: 90,
          expected: 'completed',
        },
        {
          key: 'group-before',
          index: 10,
          groupIndex: 1,
          groupTotal: 2,
          progress: 100,
          expected: 'watching',
        },
      ];
      for (const item of scenarios) {
        await storage.setFavorite(username, `source+${item.key}`, {
          ...favorite,
          watch_status: item.status,
        });
        await storage.setPlayRecord(username, `source+${item.key}`, {
          ...favorite,
          index: item.index,
          group_index: item.groupIndex,
          group_total: item.groupTotal,
          play_time: item.progress,
          total_time: 100,
          save_time: 2000,
        });
      }
      const result = await storage.getFavoriteLibraryPage(username, query);
      for (const item of scenarios) {
        const actual = result.items.find(
          (row) => row.key === `source+${item.key}`,
        )!;
        expect(actual.watchStatus).toBe(item.expected);
        expect(actual.watchStatusManual).toBe(!!item.status);
        expect(actual.watchedAt).toBe(
          item.expected === 'completed' ? 2000 : null,
        );
      }
    });

    it('批量按筛选排除项更新，恢复推导并只删除当前用户的已有收藏', async () => {
      for (const key of ['source+1', 'source+2', 'source+3'])
        await storage.setFavorite(username, key, favorite);
      await storage.setFavorite('batch-other', 'source+1', favorite);
      try {
        expect(
          await storage.batchFavorites(username, {
            action: 'set-status',
            target: {
              match: { q: 'demo', filter: 'planned' },
              exclude: ['source+2'],
            },
            watchStatus: 'completed',
            watchedAt: 3000,
          }),
        ).toEqual({ affected: 2 });
        const page = await storage.getFavoriteLibraryPage(username, {
          ...query,
          filter: 'completed',
          sort: 'watched',
        });
        expect(page.items.map((item) => item.key)).toEqual([
          'source+3',
          'source+1',
        ]);
        expect(
          page.items.every(
            (item) => item.watchStatusManual && item.watchedAt === 3000,
          ),
        ).toBe(true);
        expect(
          await storage.batchFavorites(username, {
            action: 'set-status',
            target: { keys: ['source+1', 'source+1', 'source+missing'] },
            watchStatus: null,
          }),
        ).toEqual({ affected: 1 });
        expect(
          (await storage.getFavorite(username, 'source+1'))?.watch_status,
        ).toBeUndefined();
        expect(
          (await storage.getFavoriteLibraryPage(username, query)).counts
            .planned,
        ).toBe(2);
        expect(
          await storage.batchFavorites(username, {
            action: 'remove',
            target: { match: { q: '', filter: 'planned' }, exclude: [] },
          }),
        ).toEqual({ affected: 2 });
        expect(
          await storage.getFavorite('batch-other', 'source+1'),
        ).not.toBeNull();
      } finally {
        await storage.deleteUser('batch-other');
      }
    });

    it('目录合并同作品且匹配空年份，作品查询返回最终键及有效状态', async () => {
      await storage.saveMergedFavorite(username, 'douban+1', {
        ...favorite,
        year: '',
        watch_status: 'completed',
        watched_at: 123,
        save_time: 50,
      });
      expect(
        await storage.saveMergedFavorite(username, 'source+1', favorite),
      ).toBe('source+1');
      expect(await storage.getFavorite(username, 'douban+1')).toBeNull();
      const found = await storage.getFavoriteForWork(username, {
        key: 'douban+1',
        title: favorite.title,
        year: favorite.year,
      });
      expect(found).toMatchObject({
        key: 'source+1',
        watchStatus: 'completed',
        watchStatusManual: true,
        watchedAt: 123,
        favorite: { save_time: 50 },
      });
      expect(
        await storage.saveMergedFavorite(username, 'bangumi+2', {
          ...favorite,
          watch_status: 'planned',
        }),
      ).toBe('source+1');
      expect(
        (await storage.getFavoriteLibraryPage(username, query)).total,
      ).toBe(1);
      expect(
        await storage.getFavoriteForWork(username, {
          key: 'douban+99',
          title: 'Other',
          year: '2026',
        }),
      ).toBeNull();
      expect(
        await storage.saveMergedFavorite(username, 'douban+3', {
          ...favorite,
          year: '2025',
        }),
      ).toBe('douban+3');
      expect(
        (await storage.getFavoriteLibraryPage(username, query)).total,
      ).toBe(2);
      expect(
        (await storage.getStaleFavoritePage(username, 10000, 1, 50)).items.map(
          (item) => item.key,
        ),
      ).toEqual(['source+1']);
    });

    it('公开收藏复用状态且评分仅投影公开评价，精确私密评价阻断空年份回退', async () => {
      await storage.setFavorite(username, 'source+1', favorite);
      await storage.setFavorite(username, 'source+live', {
        ...favorite,
        origin: 'live',
      });
      await storage.setVideoReview(username, {
        ...videoReview,
        title_norm: 'demo',
        year: '',
        rating: 9,
        is_public: true,
      });
      await storage.setVideoReview(username, {
        ...videoReview,
        title_norm: 'demo',
        year: '2026',
        rating: 8,
        is_public: false,
      });
      const publicPage = await storage.getFavoriteLibraryPage(username, {
        ...query,
        filter: 'completed',
        profileScope: 'public',
      });
      expect(publicPage.items).toHaveLength(1);
      expect(publicPage.items[0]).toMatchObject({
        watchStatus: 'completed',
        myRating: null,
      });
      const ownPage = await storage.getFavoriteLibraryPage(username, {
        ...query,
        profileScope: 'self',
      });
      expect(ownPage.items[0].myRating).toBe(8);
      await storage.setVideoReview(username, {
        ...videoReview,
        title_norm: 'demo',
        year: '2026',
        rating: 7,
        is_public: true,
      });
      expect(
        (
          await storage.getFavoriteLibraryPage(username, {
            ...query,
            profileScope: 'public',
          })
        ).items[0].myRating,
      ).toBe(7);
    });

    it('资料各公开等级读写和导出保持数字', async () => {
      for (const libraryVisibility of [0, 1, 2, 3] as const) {
        const profile = await storage.updateUserProfile(username, {
          libraryVisibility,
        });
        expect(profile.favorites_public).toBe(libraryVisibility);
        expect(
          (await storage.getUserProfileView(username, 'reader'))
            ?.libraryVisibility,
        ).toBe(libraryVisibility);
      }
    });

    it('资料收藏数与片单同口径，未公开时对他人为 0', async () => {
      await storage.setFavorite(username, 'source+1', favorite);
      await storage.setFavorite(username, 'source+2', {
        ...favorite,
        title: 'Other',
      });
      await storage.setFavorite(username, 'source+live', {
        ...favorite,
        title: 'Live',
        origin: 'live',
      });
      await storage.updateUserProfile(username, { libraryVisibility: 1 });
      const listed = await storage.getFavoriteLibraryPage(username, {
        ...query,
        profileScope: 'public',
      });
      expect(
        (await storage.getUserProfileView(username, 'reader'))?.favoriteCount,
      ).toBe(listed.items.length);
      expect(listed.items).toHaveLength(2);
      await storage.updateUserProfile(username, { libraryVisibility: 0 });
      expect(
        (await storage.getUserProfileView(username, 'reader'))?.favoriteCount,
      ).toBe(0);
      expect(
        (await storage.getUserProfileView(username, username))?.favoriteCount,
      ).toBe(2);
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
