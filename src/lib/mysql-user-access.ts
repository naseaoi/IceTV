import { randomUUID } from 'crypto';
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';

import { getOwnerUsername } from '@/lib/env.server';
import {
  canManageUserAccess,
  effectiveUserAccess,
  USER_ACCESS_UPSERT,
  UserAccess,
  userAccessFromRow,
  UserAccessGuard,
  UserAccessJoinedRow,
  userAccessListFromRows,
  UserAccessPatch,
  userAccessValues,
} from '@/lib/user-access';
import {
  accessNoticeAction,
  accessPermissionChanges,
  accessPermissions,
} from '@/lib/user-notice';
import {
  noticeInsert,
  settlePendingPermissionNotices,
} from '@/lib/user-notice-storage';
import { normalizeUsername } from '@/lib/username';
import type { AdminConfig } from '@/types/admin';

export class MysqlUserAccessStore {
  constructor(
    private readonly db: Pool | PoolConnection,
    private readonly lock = false,
  ) {}

  async get(username: string): Promise<UserAccess | null> {
    username = normalizeUsername(username);
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT a.username, a.role, a.banned, a.enabled_apis, m.group_name FROM user_access a LEFT JOIN user_group_members m ON m.username = a.username WHERE a.username = ? AND (a.username = ? OR EXISTS (SELECT 1 FROM users WHERE users.username = a.username)) ORDER BY m.position, m.group_name${this.lock ? ' FOR UPDATE' : ''}`,
      [username, normalizeUsername(getOwnerUsername() || '')],
    );
    if (!rows[0])
      return username === normalizeUsername(getOwnerUsername() || '')
        ? effectiveUserAccess({ username, role: 'user' })
        : null;
    return userAccessFromRow(
      rows[0] as Parameters<typeof userAccessFromRow>[0],
      rows.flatMap((row) =>
        row.group_name == null ? [] : [String(row.group_name)],
      ),
    );
  }

  async list(): Promise<UserAccess[]> {
    const [rows] = await this.db.query<(RowDataPacket & UserAccessJoinedRow)[]>(
      `SELECT a.username, a.role, a.banned, a.enabled_apis, m.group_name FROM user_access a LEFT JOIN user_group_members m ON m.username = a.username WHERE (a.username = ? OR EXISTS (SELECT 1 FROM users WHERE users.username = a.username)) ORDER BY a.username, m.position, m.group_name${this.lock ? ' FOR UPDATE' : ''}`,
      [normalizeUsername(getOwnerUsername() || '')],
    );
    return userAccessListFromRows(rows);
  }

  async put(user: UserAccess): Promise<void> {
    const username = normalizeUsername(user.username);
    await this.db.execute(USER_ACCESS_UPSERT.mysql, userAccessValues(user));
    await this.db.execute('DELETE FROM user_group_members WHERE username = ?', [
      username,
    ]);
    for (const [position, group] of [...new Set(user.tags || [])].entries())
      await this.db.execute(
        'INSERT INTO user_group_members (username, group_name, position) VALUES (?, ?, ?)',
        [username, group, position],
      );
  }

  async update(
    usernames: string[],
    patch: UserAccessPatch,
    guard?: UserAccessGuard,
  ): Promise<number> {
    const [configRows] = await this.db.query<RowDataPacket[]>(
      'SELECT config_json FROM admin_config WHERE id = 1 FOR UPDATE',
    );
    const config = configRows[0]
      ? (JSON.parse(String(configRows[0].config_json)) as AdminConfig)
      : null;
    let count = 0;
    for (const username of [
      ...new Set(usernames.map(normalizeUsername)),
    ].sort()) {
      const user = await this.get(username);
      if (!user || !canManageUserAccess(user, guard)) continue;
      const next = effectiveUserAccess({ ...user, ...patch });
      await this.put(next);
      const change = accessNoticeAction(user, next);
      const payload = accessPermissionChanges(
        accessPermissions(user, config),
        accessPermissions(next, config),
      );
      const action =
        change === 'permissions-changed' && !payload ? null : change;
      if (action) {
        const now = Date.now();
        const settle = settlePendingPermissionNotices(username, now);
        await this.db.execute(settle.sql, settle.params);
        const event = noticeInsert(
          'mysql',
          username,
          randomUUID(),
          'account-change',
          action,
          action === 'permissions-changed' ? payload! : {},
          now,
        );
        await this.db.execute(event.sql, event.params);
      }
      count++;
    }
    return count;
  }

  async removeGroup(group: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM user_group_members WHERE group_name = ?',
      [group],
    );
  }

  async removeSource(source: string): Promise<void> {
    await this.removeSources([source]);
  }

  async removeSources(sources: string[]): Promise<void> {
    if (!sources.length) return;
    const removed = new Set(sources);
    const [rows] = await this.db.query<RowDataPacket[]>(
      'SELECT username, enabled_apis FROM user_access WHERE enabled_apis IS NOT NULL FOR UPDATE',
    );
    const changes = rows.flatMap((row) => {
      const before = JSON.parse(String(row.enabled_apis)) as string[];
      const after = before.filter((key) => !removed.has(key));
      return after.length === before.length
        ? []
        : [
            {
              username: String(row.username),
              apis: after.length ? JSON.stringify(after) : null,
            },
          ];
    });
    const now = Date.now();
    for (let offset = 0; offset < changes.length; offset += 500) {
      const batch = changes.slice(offset, offset + 500);
      await this.db.execute(
        `UPDATE user_access SET enabled_apis = CASE username ${batch.map(() => 'WHEN ? THEN ?').join(' ')} END, updated_at = ? WHERE username IN (${batch.map(() => '?').join(', ')})`,
        [
          ...batch.flatMap((row) => [row.username, row.apis]),
          now,
          ...batch.map((row) => row.username),
        ],
      );
    }
  }

  async backfill(): Promise<void> {
    await this.db.execute(
      "INSERT IGNORE INTO user_access (username, role, banned, updated_at) SELECT username, 'user', 0, ? FROM users",
      [Date.now()],
    );
  }

  async importConfig(config: AdminConfig): Promise<AdminConfig> {
    for (const user of config.UserConfig?.Users || [])
      if (normalizeUsername(user.username)) await this.put(user);
    const clean = { ...config, UserConfig: { ...config.UserConfig } };
    delete clean.UserConfig.Users;
    await this.backfill();
    return clean;
  }

  async migrate(): Promise<void> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      'SELECT config_json FROM admin_config WHERE id = 1 FOR UPDATE',
    );
    if (rows[0]) {
      const raw = rows[0].config_json;
      const config = (
        typeof raw === 'string' ? JSON.parse(raw) : raw
      ) as AdminConfig;
      if (Array.isArray(config.UserConfig?.Users)) {
        const clean = await this.importConfig(config);
        const [result] = await this.db.execute<ResultSetHeader>(
          'UPDATE admin_config SET config_json = ? WHERE id = 1 AND CAST(config_json AS CHAR) = CAST(? AS CHAR)',
          [
            JSON.stringify(clean),
            typeof raw === 'string' ? raw : JSON.stringify(raw),
          ],
        );
        if (result.affectedRows !== 1) throw new Error('用户权限迁移配置冲突');
      }
    }
    await this.backfill();
  }
}
