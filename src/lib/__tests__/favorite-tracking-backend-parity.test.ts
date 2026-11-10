/** @jest-environment node */

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import {
  buildFavoriteUpdateMessage,
  favoriteMessageQueries,
} from '@/features/favorites/lib/favorite-tracking';
import { MySqlStorage } from '@/lib/mysql.db';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import type { Favorite } from '@/lib/types';

installCryptoPolyfill();
const liveUrl = process.env.MYSQL_TEST_URL;
const base: Favorite = {
  title: '收藏剧集',
  year: '2026',
  source_name: '源',
  cover: '',
  total_episodes: 10,
  save_time: 1,
  origin: 'vod',
};

for (const backend of ['sqlite', 'mysql'] as const) {
  (backend === 'mysql' && !liveUrl ? describe.skip : describe)(
    `${backend} 收藏追更契约`,
    () => {
      let storage: LocalSqliteStorage | MySqlStorage;
      let user: string;
      beforeAll(() => {
        storage =
          backend === 'sqlite'
            ? new LocalSqliteStorage(':memory:')
            : new MySqlStorage(liveUrl!);
      });
      beforeEach(() => {
        user = `favorite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      });
      afterAll(async () => {
        if (backend === 'mysql')
          await (
            storage as unknown as { pool: { end(): Promise<void> } }
          ).pool.end();
      });

      it('新增收藏建立基线，重存与目录合并保留基线，缺基线旧收藏不回灌', async () => {
        await storage.saveMergedFavorite(user, 'source+1', {
          ...base,
          update_baseline_episodes: 0,
          update_detected_at: 123,
        });
        expect(await storage.getFavorite(user, 'source+1')).toMatchObject({
          update_baseline_episodes: 10,
        });
        expect(
          (await storage.getFavoriteUpdateMessagePage(user, 10)).total,
        ).toBe(0);
        await storage.setFavorite(user, 'source+1', {
          ...base,
          total_episodes: 12,
          update_baseline_episodes: 10,
          update_detected_at: 100,
        });
        await storage.saveMergedFavorite(user, 'source+1', {
          ...base,
          total_episodes: 12,
          update_baseline_episodes: 12,
        });
        await storage.saveMergedFavorite(user, 'douban+2', base);
        expect(await storage.getFavorite(user, 'source+1')).toMatchObject({
          update_baseline_episodes: 10,
          update_detected_at: 100,
        });
        await storage.setFavorite(user, 'source+old', {
          ...base,
          title: '旧收藏',
          update_detected_at: 200,
        });
        expect(
          (await storage.getFavoriteUpdateMessagePage(user, 10)).total,
        ).toBe(1);
      });

      it('分页、计数、源站范围与同键播放排除一致', async () => {
        const unread = {
          ...base,
          update_baseline_episodes: 8,
          update_detected_at: 100,
        };
        for (const [key, value] of Object.entries({
          'source+a': unread,
          'source+b': unread,
          'source+legacy-vod': { ...unread, origin: undefined },
          'source+read': { ...unread, update_baseline_episodes: 10 },
          'source+missing': { ...unread, update_baseline_episodes: undefined },
          'source+null': {
            ...unread,
            update_baseline_episodes: null as unknown as number,
          },
          'source+string': {
            ...unread,
            update_baseline_episodes: 'bad' as unknown as number,
          },
          'source+fraction': { ...unread, total_episodes: 10.5 },
          'source+zero-time': { ...unread, update_detected_at: 0 },
          'douban+1': unread,
          'bangumi+2': unread,
          'source+live': { ...unread, origin: 'live' as const },
          'source+played': unread,
        }))
          await storage.setFavorite(user, key, value);
        await storage.setPlayRecord(user, 'source+played', {
          ...base,
          index: 1,
          play_time: 0,
          total_time: 100,
          tracking_enabled: false,
        });
        const first = await storage.getFavoriteUpdateMessagePage(user, 2);
        expect(first.total).toBe(3);
        expect(first.items.map((item) => item.recordKey)).toEqual([
          'source+legacy-vod',
          'source+b',
        ]);
        const second = await storage.getFavoriteUpdateMessagePage(user, 2, {
          createdAt: 100,
          key: 'favorite-tracking:source+b',
        });
        expect(second.items.map((item) => item.recordKey)).toEqual([
          'source+a',
        ]);
        expect(second.total).toBe(3);
        expect(
          (
            await storage.getFavoriteUpdateMessagePage(user, 20, {
              createdAt: 100,
              key: 'tracking:source+a',
            })
          ).items,
        ).toHaveLength(3);
        expect(
          (
            await storage.getFavoriteUpdateMessagePage(user, 20, {
              createdAt: 100,
              key: 'announcement:a',
            })
          ).items,
        ).toHaveLength(0);
      });

      it('千条收藏摘要只扫描当前用户并以主键关联播放记录', async () => {
        for (let i = 0; i < 1000; i++)
          await storage.setFavorite(user, `source+${i}`, {
            ...base,
            update_baseline_episodes: 8,
            update_detected_at: 100,
          });
        const sql = favoriteMessageQueries(backend, user, 1);
        if (backend === 'sqlite') {
          const raw = (
            storage as unknown as { db: import('better-sqlite3').Database }
          ).db;
          const plan = raw
            .prepare(`EXPLAIN QUERY PLAN ${sql.page}`)
            .all(...sql.params);
          expect(JSON.stringify(plan)).toMatch(/SEARCH f USING INDEX/);
          expect(JSON.stringify(plan)).toMatch(/SEARCH p USING/);
        } else {
          const pool = (
            storage as unknown as { pool: import('mysql2/promise').Pool }
          ).pool;
          const [plan] = await pool.query(`EXPLAIN ${sql.page}`, sql.params);
          expect(JSON.stringify(plan)).toContain('PRIMARY');
        }
        const start = performance.now();
        const page = await storage.getFavoriteUpdateMessagePage(user, 1);
        console.log(
          `${backend} 1000 favorites summary: ${(performance.now() - start).toFixed(1)}ms`,
        );
        expect(page.total).toBe(1000);
        expect(page.items).toHaveLength(1);
      }, 60000);

      it('已读单调推进且保留刷新后的新增集数、观看状态与取消收藏', async () => {
        const unread = {
          ...base,
          total_episodes: 12,
          update_baseline_episodes: 8,
          update_detected_at: 200,
          watch_status: 'planned' as const,
        };
        await storage.setFavorite(user, 'source+1', unread);
        const snapshot = (
          await storage.getStaleFavoritePage(user, Date.now(), 1, 10)
        ).items[0].snapshot;
        await storage.readFavoriteUpdate(user, 'source+1', 10);
        await storage.readFavoriteUpdate(user, 'source+1', 9);
        expect(await storage.getFavorite(user, 'source+1')).toMatchObject({
          total_episodes: 12,
          update_baseline_episodes: 10,
          watch_status: 'planned',
        });
        expect(
          (await storage.getFavoriteUpdateMessagePage(user, 10)).items[0],
        ).toMatchObject({ fromEpisodes: 10, toEpisodes: 12 });
        expect(
          await storage.setFavoriteIfUnchanged(
            user,
            'source+1',
            { ...unread, total_episodes: 13 },
            snapshot,
          ),
        ).toBe(false);
        await storage.readFavoriteUpdate(user, 'source+1', 12);
        expect(
          (await storage.getFavoriteUpdateMessagePage(user, 10)).total,
        ).toBe(0);
        await storage.deleteFavorite(user, 'source+1');
        await storage.readFavoriteUpdate(user, 'source+1', 12);
        expect(await storage.getFavorite(user, 'source+1')).toBeNull();
      });
    },
  );
}

it('收藏消息复用追更展示且保留独立标识', () => {
  expect(
    buildFavoriteUpdateMessage('source+1', {
      ...base,
      update_baseline_episodes: 8,
      update_detected_at: 200,
    }),
  ).toMatchObject({
    type: 'tracking-update',
    id: 'favorite-tracking:source%2B1:8:10',
    fromEpisodes: 8,
    toEpisodes: 10,
    createdAt: 200,
  });
});
