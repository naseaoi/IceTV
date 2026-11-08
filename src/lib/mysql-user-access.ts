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
  UserAccessPatch,
  userAccessValues,
} from '@/lib/user-access';
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
      `SELECT username, role, banned, enabled_apis FROM user_access WHERE username = ? AND (username = ? OR EXISTS (SELECT 1 FROM users WHERE users.username = user_access.username))${this.lock ? ' FOR UPDATE' : ''}`,
      [username, normalizeUsername(getOwnerUsername() || '')],
    );
    if (!rows[0])
      return username === normalizeUsername(getOwnerUsername() || '')
        ? effectiveUserAccess({ username, role: 'user' })
        : null;
    const [tags] = await this.db.query<RowDataPacket[]>(
      'SELECT group_name FROM user_group_members WHERE username = ? ORDER BY position, group_name',
      [username],
    );
    return userAccessFromRow(
      rows[0] as Parameters<typeof userAccessFromRow>[0],
      tags.map((row) => String(row.group_name)),
    );
  }

  async all(): Promise<UserAccess[]> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      'SELECT username FROM user_access ORDER BY username',
    );
    const result: UserAccess[] = [];
    for (const row of rows) {
      const user = await this.get(String(row.username));
      if (user) result.push(user);
    }
    const owner = normalizeUsername(getOwnerUsername() || '');
    if (owner && !result.some((row) => row.username === owner))
      result.push((await this.get(owner))!);
    return result;
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
    let count = 0;
    for (const username of [
      ...new Set(usernames.map(normalizeUsername)),
    ].sort()) {
      const user = await this.get(username);
      if (!user || !canManageUserAccess(user, guard)) continue;
      await this.put({ ...user, ...patch });
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
    const [rows] = await this.db.query<RowDataPacket[]>(
      'SELECT username, enabled_apis FROM user_access WHERE enabled_apis IS NOT NULL FOR UPDATE',
    );
    for (const row of rows) {
      const sources = (JSON.parse(String(row.enabled_apis)) as string[]).filter(
        (key) => key !== source,
      );
      await this.db.execute(
        'UPDATE user_access SET enabled_apis = ?, updated_at = ? WHERE username = ?',
        [
          sources.length ? JSON.stringify(sources) : null,
          Date.now(),
          row.username,
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
