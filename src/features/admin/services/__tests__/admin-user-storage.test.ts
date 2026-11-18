/** @jest-environment node */

import type Database from 'better-sqlite3';
import type { Pool } from 'mysql2/promise';

import { ADMIN_USER_SORTS } from '@/features/admin/lib/user-query';
import { adminUserStatements } from '@/features/admin/services/userQueryStorage';
import { MySqlStorage } from '@/lib/mysql.db';
import { MysqlUserAccessStore } from '@/lib/mysql-user-access';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import { SqliteUserAccessStore } from '@/lib/sqlite-user-access';
import type { IStorage } from '@/lib/types';
import type { AdminConfig } from '@/types/admin';

const liveUrl = process.env.MYSQL_TEST_URL;
for (const backend of ['sqlite', 'mysql'] as const) {
  (backend === 'mysql' && !liveUrl ? describe.skip : describe)(
    `${backend} admin user pagination`,
    () => {
      let storage: IStorage;
      const names = ['page-alice', 'page-bob', 'page-carol', 'page-dave'];
      const query = {
        ownerUsername: 'page-owner',
        operatorUsername: 'page-owner',
        limit: 2,
      };
      const config = {
        UserConfig: {
          Users: [
            { username: 'PAGE-ALICE', role: 'admin', tags: ['VIP'] },
            {
              username: 'page-bob',
              role: 'user',
              banned: true,
              tags: ['VIP'],
              enabledApis: ['source'],
            },
            { username: 'page-owner', role: 'owner' },
          ],
        },
      } as AdminConfig;
      beforeAll(async () => {
        storage =
          backend === 'sqlite'
            ? new LocalSqliteStorage(':memory:')
            : new MySqlStorage(liveUrl!);
        for (const name of names) {
          await storage.deleteUser(name);
          await storage.registerUser(
            name.toUpperCase(),
            'password',
            name === 'page-carol' ? 'Élodie' : undefined,
          );
          await storage.recordUserLogin(name, 1000);
        }
        for (const entry of config.UserConfig.Users || []) {
          await storage.updateUserAccess([entry.username], entry);
        }
        await storage.setAdminConfig(config);
      });
      afterAll(async () => {
        for (const name of names) await storage.deleteUser(name);
        if (backend === 'mysql')
          await (
            storage as unknown as { pool: { end(): Promise<void> } }
          ).pool.end();
        else (storage as unknown as { db: { close(): void } }).db.close();
      });
      it.each(ADMIN_USER_SORTS)(
        'paginates %s without gaps or duplicates and keeps a stable total',
        async (sort) => {
          const seen: string[] = [];
          let cursor: string | undefined;
          do {
            const page = await storage.getAdminUserPage({
              ...query,
              q: 'page-',
              sort,
              cursor,
            });
            expect(page.total).toBe(5);
            seen.push(...page.items.map((row) => row.username));
            cursor = page.nextCursor || undefined;
          } while (cursor);
          expect(seen).toHaveLength(5);
          expect([...seen].sort()).toEqual([...names, 'page-owner'].sort());
        },
      );
      it('applies identical role, group, literal search and exclusions', async () => {
        const page = await storage.getAdminUserPage({
          ...query,
          group: 'VIP',
          excluded: ['PAGE-ALICE'],
        });
        expect(page.total).toBe(1);
        expect(page.items[0]).toMatchObject({
          username: 'page-bob',
          banned: true,
          tags: ['VIP'],
          enabledApis: ['source'],
          lastActiveAt: 1000,
        });
        expect(
          (await storage.getAdminUserPage({ ...query, q: '%' })).total,
        ).toBe(0);
        expect(
          (
            await storage.getAdminUserPage({ ...query, filter: 'admin' })
          ).items.map((row) => row.username),
        ).toEqual(['page-alice']);
        expect(
          (await storage.getAdminUserPage({ ...query, q: 'élo' })).items.map(
            (row) => row.username,
          ),
        ).toEqual(['page-carol']);
        expect(
          (await storage.getAdminUserPage({ ...query, q: 'elo' })).total,
        ).toBe(0);
        expect(
          (await storage.getAdminUserPage({ ...query, group: 'vip' })).total,
        ).toBe(0);
      });
      it('records the invite code used at registration until the user is deleted', async () => {
        const name = 'page-erin';
        await storage.deleteUser(name);
        try {
          await storage.registerUser(
            name,
            'password',
            undefined,
            undefined,
            undefined,
            'PAGEINV1',
          );
          const byCode = await storage.getAdminUserPage({
            ...query,
            q: 'pageinv1',
          });
          expect(byCode.items).toEqual([
            expect.objectContaining({ username: name, inviteCode: 'PAGEINV1' }),
          ]);
          expect(
            (await storage.getAdminUserPage({ ...query, q: 'pageinv' })).total,
          ).toBe(0);

          await storage.deleteUser(name);
          await storage.registerUser(name, 'password');
          const page = await storage.getAdminUserPage({ ...query, q: name });
          expect(page.items[0]).toMatchObject({
            username: name,
            inviteCode: null,
          });
        } finally {
          await storage.deleteUser(name);
        }
      });
      it('binds cursors to filters', async () => {
        const page = await storage.getAdminUserPage(query);
        await expect(
          storage.getAdminUserPage({
            ...query,
            filter: 'banned',
            cursor: page.nextCursor!,
          }),
        ).rejects.toThrow('用户游标无效');
      });
      it('reports the database execution plan for joined pagination', async () => {
        const sql = adminUserStatements(backend, query);
        if (backend === 'mysql') {
          const [rows] = await (
            storage as unknown as {
              pool: {
                query(
                  sql: string,
                  params: unknown[],
                ): Promise<[unknown, unknown]>;
              };
            }
          ).pool.query(`EXPLAIN ${sql.rows}`, sql.params);
          expect(JSON.stringify(rows)).toMatch(
            /PRIMARY|idx_user_access|idx_user_group_members/,
          );
          expect(sql.rows).not.toMatch(
            /UserConfig.Users|json_each\(COALESCE|JSON_TABLE\(c.config_json/,
          );
          console.log('MySQL admin users EXPLAIN', rows);
        } else {
          const rows = (
            storage as unknown as {
              db: {
                prepare(sql: string): { all(...params: unknown[]): unknown };
              };
            }
          ).db
            .prepare(`EXPLAIN QUERY PLAN ${sql.rows}`)
            .all(...sql.params);
          expect(JSON.stringify(rows)).toMatch(
            /SEARCH m USING INDEX sqlite_autoindex_user_access/,
          );
          expect(sql.rows).not.toMatch(/UserConfig.Users|json_each\(COALESCE/);
          console.log('SQLite admin users EXPLAIN', rows);
        }
      });
      it('atomically rejects stale config and activity snapshots', async () => {
        const next = { ...config, ConfigFile: 'changed' };
        const results = await Promise.all([
          storage.compareAndSetAdminConfig(config, next),
          storage.compareAndSetAdminConfig(config, {
            ...config,
            ConfigFile: 'other',
          }),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        await storage.updateUserAccess(['page-bob'], { role: 'admin' });
        expect(
          await storage.deleteUserIfInactive('page-bob', 1000, 'page-owner'),
        ).toBe(false);
        await storage.updateUserAccess(['page-bob'], { role: 'user' });
        await storage.recordUserLogin('page-bob', 2000);
        expect(
          await storage.deleteUserIfInactive('page-bob', 1000, 'page-owner'),
        ).toBe(false);
        expect(await storage.checkUserExist('page-bob')).toBe(true);
      });
      it('migrates legacy rows once and atomically cleans removed references', async () => {
        await storage.setAdminConfig({
          ...config,
          SourceConfig: [
            {
              key: 'source',
              name: 'Source',
              api: 'https://example.com',
              from: 'custom',
            },
          ],
          UserConfig: {
            ...config.UserConfig,
            Tags: [{ name: 'VIP', enabledApis: [] }],
          },
        } as AdminConfig);
        const migrate = async () => {
          if (backend === 'sqlite') {
            new SqliteUserAccessStore(
              (storage as unknown as { db: Database.Database }).db,
            ).migrate();
          } else {
            const connection = await (
              storage as unknown as { pool: Pool }
            ).pool.getConnection();
            try {
              await connection.beginTransaction();
              await new MysqlUserAccessStore(connection, true).migrate();
              await connection.commit();
            } catch (error) {
              await connection.rollback();
              throw error;
            } finally {
              connection.release();
            }
          }
        };
        await Promise.all([migrate(), migrate()]);
        expect(
          (await storage.getAdminConfig())?.UserConfig.Users,
        ).toBeUndefined();
        expect(await storage.getUserAccess('PAGE-BOB')).toMatchObject({
          banned: true,
          tags: ['VIP'],
          enabledApis: ['source'],
        });
        await storage.updateUserAccess(['page-bob'], { banned: false });
        await migrate();
        expect((await storage.getUserAccess('page-bob'))?.banned).toBe(false);
        const current = (await storage.getAdminConfig())!;
        expect(
          await storage.compareAndSetAdminConfig(current, {
            ...current,
            SourceConfig: [],
            UserConfig: { Tags: [] },
          }),
        ).toBe(true);
        expect((await storage.getUserAccess('page-bob'))?.tags).toBeUndefined();
        expect(
          (await storage.getUserAccess('page-bob'))?.enabledApis,
        ).toBeUndefined();
      });
    },
  );
}
