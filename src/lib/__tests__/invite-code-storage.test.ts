/** @jest-environment node */

import Database from 'better-sqlite3';

import { LocalSqliteStorage } from '@/lib/sqlite.db';
import { SqliteInviteCodeStore } from '@/lib/sqlite-invite-code-store';
import type { AdminConfig } from '@/types/admin';

const makeCode = (code: string, extra = {}) => ({
  code,
  createdAt: 1,
  expiresAt: Date.now() + 86400000,
  createdBy: 'owner',
  ...extra,
});

describe('邀请码数据库分页及迁移', () => {
  it('同创建时间按码倒序分页，游标绑定筛选', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    for (const code of ['AAAA', 'BBBB', 'CCCC'])
      await storage.createInviteCode(makeCode(code));
    const first = await storage.queryInviteCodes({ limit: 2 });
    expect(first.items.map((item) => item.code)).toEqual(['CCCC', 'BBBB']);
    expect(first).toMatchObject({ total: 3, activeCount: 3 });
    const second = await storage.queryInviteCodes({
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((item) => item.code)).toEqual(['AAAA']);
    expect(second.nextCursor).toBeNull();
    await expect(
      storage.queryInviteCodes({ filter: 'active', cursor: first.nextCursor! }),
    ).rejects.toThrow('邀请码游标无效');
  });

  it('有效、过期、用尽筛选在 SQL 计数，过期与不存在的码不能消费', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.createInviteCode(makeCode('ACTIVE'));
    await storage.createInviteCode(
      makeCode('EXPIRED', { expiresAt: Date.now() - 1 }),
    );
    await storage.createInviteCode(
      makeCode('EXHAUSTED', { maxUses: 1, usedCount: 1 }),
    );
    for (const filter of ['active', 'expired', 'exhausted'] as const) {
      expect(await storage.queryInviteCodes({ filter })).toMatchObject({
        total: 1,
        activeCount: 1,
      });
    }
    expect(await storage.reserveInviteCodeUse('EXPIRED')).toBe(false);
    expect(await storage.reserveInviteCodeUse('MISSING')).toBe(false);
    expect(await storage.reserveInviteCodeUse('EXHAUSTED')).toBe(false);
  });

  it('创建有效码的上限在事务内判断，失效同名码重建归零', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.createInviteCode(
      makeCode('RECREATE', { maxUses: 1, usedCount: 1 }),
    );
    expect(
      await storage.createInviteCode(makeCode('RECREATE', { maxUses: 3 })),
    ).toBe('created');
    expect(await storage.createInviteCode(makeCode('RECREATE'))).toBe('exists');
    expect((await storage.getAllInviteCodes())[0].usedCount).toBe(0);
    const results = await Promise.all(
      Array.from({ length: 205 }, (_, i) =>
        storage.createInviteCode(makeCode(`LIMIT-${i}`)),
      ),
    );
    expect(results.filter((item) => item === 'created')).toHaveLength(199);
    expect(await storage.countActiveInviteCodes()).toBe(200);
  });

  it('启动迁移取历史用量较大值、移除配置字段、重跑不复活已删码', () => {
    const storage = new LocalSqliteStorage(':memory:');
    const database = (storage as unknown as { db: Database.Database }).db;
    const config = {
      UserConfig: {
        InviteCodes: [
          makeCode('LEGACY', { maxUses: 10, usedCount: 2 }),
          makeCode('CONFIG', { usedCount: 5 }),
        ],
      },
    };
    database
      .prepare('INSERT INTO admin_config (id, config_json) VALUES (1, ?)')
      .run(JSON.stringify(config));
    database
      .prepare('INSERT INTO invite_code_usage(code, used_count) VALUES (?, ?)')
      .run('LEGACY', 4);
    const store = new SqliteInviteCodeStore(database);
    store.migrate();
    expect(store.all().find((item) => item.code === 'LEGACY')?.usedCount).toBe(
      4,
    );
    expect(store.all().find((item) => item.code === 'CONFIG')?.usedCount).toBe(
      5,
    );
    const persisted = database
      .prepare('SELECT config_json FROM admin_config')
      .get() as { config_json: string };
    expect(
      JSON.parse(persisted.config_json).UserConfig.InviteCodes,
    ).toBeUndefined();
    expect(database.prepare('SELECT * FROM invite_code_usage').all()).toEqual(
      [],
    );
    store.delete('LEGACY');
    store.migrate();
    expect(store.all().map((item) => item.code)).toEqual(['CONFIG']);
  });

  it('备份替换导入包含邀请码定义与用量，持久化配置不带邀请码', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    await storage.replaceAllData({
      adminConfig: {
        UserConfig: { InviteCodes: [makeCode('BACKUP', { usedCount: 2 })] },
      } as AdminConfig,
      users: {},
      userData: {},
      sourceRouteStats: [],
      inviteCodeUsage: { BACKUP: 3 },
    });
    expect(await storage.getAllInviteCodes()).toEqual([
      expect.objectContaining({ code: 'BACKUP', usedCount: 3 }),
    ]);
    expect(
      (await storage.getAdminConfig())?.UserConfig.InviteCodes,
    ).toBeUndefined();
    await storage.clearAllData();
    expect(await storage.getAllInviteCodes()).toEqual([]);
  });
});
