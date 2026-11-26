import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

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

export class SqliteUserAccessStore {
  constructor(private readonly db: Database.Database) {}

  get(username: string): UserAccess | null {
    username = normalizeUsername(username);
    const rows = this.db
      .prepare(
        'SELECT a.username, a.role, a.banned, a.enabled_apis, m.group_name FROM user_access a LEFT JOIN user_group_members m ON m.username = a.username WHERE a.username = ? AND (a.username = ? OR EXISTS (SELECT 1 FROM users WHERE users.username = a.username)) ORDER BY m.position, m.group_name',
      )
      .all(
        username,
        normalizeUsername(getOwnerUsername() || ''),
      ) as (Parameters<typeof userAccessFromRow>[0] & {
      group_name: string | null;
    })[];
    if (!rows[0])
      return username === normalizeUsername(getOwnerUsername() || '')
        ? effectiveUserAccess({ username, role: 'user' })
        : null;
    return userAccessFromRow(
      rows[0],
      rows.flatMap((row) => (row.group_name === null ? [] : [row.group_name])),
    );
  }

  list(): UserAccess[] {
    const rows = this.db
      .prepare(
        'SELECT a.username, a.role, a.banned, a.enabled_apis, m.group_name FROM user_access a LEFT JOIN user_group_members m ON m.username = a.username WHERE (a.username = ? OR EXISTS (SELECT 1 FROM users WHERE users.username = a.username)) ORDER BY a.username, m.position, m.group_name',
      )
      .all(
        normalizeUsername(getOwnerUsername() || ''),
      ) as UserAccessJoinedRow[];
    return userAccessListFromRows(rows);
  }

  put(user: UserAccess): void {
    const username = normalizeUsername(user.username);
    this.db.prepare(USER_ACCESS_UPSERT.sqlite).run(...userAccessValues(user));
    this.db
      .prepare('DELETE FROM user_group_members WHERE username = ?')
      .run(username);
    const insert = this.db.prepare(
      'INSERT INTO user_group_members (username, group_name, position) VALUES (?, ?, ?)',
    );
    [...new Set(user.tags || [])].forEach((group, position) =>
      insert.run(username, group, position),
    );
  }

  update(
    usernames: string[],
    patch: UserAccessPatch,
    guard?: UserAccessGuard,
  ): number {
    return this.db
      .transaction(() => {
        const configRow = this.db
          .prepare('SELECT config_json FROM admin_config WHERE id = 1')
          .get() as { config_json: string } | undefined;
        const config = configRow
          ? (JSON.parse(configRow.config_json) as AdminConfig)
          : null;
        let count = 0;
        for (const username of [
          ...new Set(usernames.map(normalizeUsername)),
        ].sort()) {
          const user = this.get(username);
          if (!user || !canManageUserAccess(user, guard)) continue;
          const next = effectiveUserAccess({ ...user, ...patch });
          this.put(next);
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
            this.db.prepare(settle.sql).run(...settle.params);
            const event = noticeInsert(
              'sqlite',
              username,
              randomUUID(),
              'account-change',
              action,
              action === 'permissions-changed' ? payload! : {},
              now,
            );
            this.db.prepare(event.sql).run(...event.params);
          }
          count++;
        }
        return count;
      })
      .immediate();
  }

  removeGroup(group: string): void {
    this.db
      .transaction(() =>
        this.db
          .prepare('DELETE FROM user_group_members WHERE group_name = ?')
          .run(group),
      )
      .immediate();
  }

  removeSource(source: string): void {
    this.db.transaction(() => this.removeSources([source])).immediate();
  }

  removeSources(sources: string[]): void {
    if (!sources.length) return;
    const removed = new Set(sources);
    const rows = this.db
      .prepare(
        'SELECT username, enabled_apis FROM user_access WHERE enabled_apis IS NOT NULL',
      )
      .all() as { username: string; enabled_apis: string }[];
    const update = this.db.prepare(
      'UPDATE user_access SET enabled_apis = ?, updated_at = ? WHERE username = ?',
    );
    const now = Date.now();
    for (const row of rows) {
      const before = JSON.parse(row.enabled_apis) as string[];
      const after = before.filter((key) => !removed.has(key));
      if (after.length !== before.length)
        update.run(
          after.length ? JSON.stringify(after) : null,
          now,
          row.username,
        );
    }
  }

  backfill(): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO user_access (username, role, banned, updated_at) SELECT username, 'user', 0, ? FROM users",
      )
      .run(Date.now());
  }

  importConfig(config: AdminConfig): AdminConfig {
    for (const user of config.UserConfig?.Users || [])
      if (normalizeUsername(user.username)) this.put(user);
    const clean = { ...config, UserConfig: { ...config.UserConfig } };
    delete clean.UserConfig.Users;
    this.backfill();
    return clean;
  }

  migrate(): void {
    this.db
      .transaction(() => {
        const row = this.db
          .prepare('SELECT config_json FROM admin_config WHERE id = 1')
          .get() as { config_json: string } | undefined;
        if (row) {
          const config = JSON.parse(row.config_json) as AdminConfig;
          if (Array.isArray(config.UserConfig?.Users)) {
            const clean = this.importConfig(config);
            const result = this.db
              .prepare(
                'UPDATE admin_config SET config_json = ? WHERE id = 1 AND config_json = ?',
              )
              .run(JSON.stringify(clean), row.config_json);
            if (result.changes !== 1) throw new Error('用户权限迁移配置冲突');
          }
        }
        this.backfill();
      })
      .immediate();
  }
}
