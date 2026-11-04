import { getOwnerUsername } from '@/lib/env.server';
import { normalizeUsername } from '@/lib/username';
import type { AdminConfig } from '@/types/admin';

export interface UserAccess {
  username: string;
  role: 'user' | 'admin' | 'owner';
  banned?: boolean;
  enabledApis?: string[];
  tags?: string[];
}
export type UserAccessPatch = Partial<Omit<UserAccess, 'username'>>;
export type UserAccessGuard = {
  operatorUsername: string;
  operatorRole: 'owner' | 'admin';
  excludeSelf?: boolean;
};

export function effectiveUserAccess(user: UserAccess): UserAccess {
  const username = normalizeUsername(user.username);
  const owner = username === normalizeUsername(getOwnerUsername() || '');
  return {
    ...user,
    username,
    role: owner ? 'owner' : user.role === 'admin' ? 'admin' : 'user',
    banned: owner ? false : !!user.banned,
  };
}

export function canManageUserAccess(
  user: UserAccess,
  guard?: UserAccessGuard,
): boolean {
  if (!guard) return true;
  const self = user.username === normalizeUsername(guard.operatorUsername);
  if (guard.excludeSelf && (self || user.role === 'owner')) return false;
  return (
    guard.operatorRole === 'owner' ||
    (user.role !== 'owner' && (user.role !== 'admin' || self))
  );
}

export function userAccessSchema(dialect: 'sqlite' | 'mysql'): string[] {
  const mysql = dialect === 'mysql';
  const text = mysql
    ? 'VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'
    : 'TEXT COLLATE BINARY';
  const suffix = mysql
    ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin'
    : '';
  return [
    `CREATE TABLE IF NOT EXISTS user_access (username ${text} PRIMARY KEY, role VARCHAR(16) NOT NULL DEFAULT 'user', banned INTEGER NOT NULL DEFAULT 0, enabled_apis TEXT NULL, updated_at BIGINT NOT NULL, ${mysql ? 'INDEX' : ''} ${mysql ? 'idx_user_access_role (role, username), INDEX idx_user_access_banned (banned, username)' : 'CHECK (banned IN (0, 1))'})${suffix}`,
    `CREATE TABLE IF NOT EXISTS user_group_members (username ${text} NOT NULL, group_name ${text} NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(username, group_name)${mysql ? ', INDEX idx_user_group_members_group (group_name, username)' : ''})${suffix}`,
    ...(mysql
      ? []
      : [
          'CREATE INDEX IF NOT EXISTS idx_user_access_role ON user_access(role, username)',
          'CREATE INDEX IF NOT EXISTS idx_user_access_banned ON user_access(banned, username)',
          'CREATE INDEX IF NOT EXISTS idx_user_group_members_group ON user_group_members(group_name, username)',
        ]),
  ];
}

export function userAccessValues(
  user: UserAccess,
): [string, string, number, string | null, number] {
  const effective = effectiveUserAccess(user);
  return [
    effective.username,
    effective.role === 'admin' ? 'admin' : 'user',
    effective.banned ? 1 : 0,
    effective.enabledApis?.length
      ? JSON.stringify(effective.enabledApis)
      : null,
    Date.now(),
  ];
}

export function userAccessFromRow(
  row: {
    username: string;
    role: string;
    banned: number;
    enabled_apis: string | null;
  },
  tags: string[],
): UserAccess {
  return effectiveUserAccess({
    username: row.username,
    role: row.role === 'admin' ? 'admin' : 'user',
    banned: !!row.banned,
    enabledApis: row.enabled_apis ? JSON.parse(row.enabled_apis) : undefined,
    tags: tags.length ? tags : undefined,
  });
}

export function removedAccessReferences(
  previous: AdminConfig | null,
  next: AdminConfig,
) {
  return {
    groups: (previous?.UserConfig?.Tags || [])
      .filter(
        (group) =>
          !next.UserConfig?.Tags?.some((item) => item.name === group.name),
      )
      .map((group) => group.name),
    sources: (previous?.SourceConfig || [])
      .filter(
        (source) => !next.SourceConfig?.some((item) => item.key === source.key),
      )
      .map((source) => source.key),
  };
}

export const USER_ACCESS_UPSERT = {
  sqlite:
    'INSERT INTO user_access (username, role, banned, enabled_apis, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET role = excluded.role, banned = excluded.banned, enabled_apis = excluded.enabled_apis, updated_at = excluded.updated_at',
  mysql:
    'INSERT INTO user_access (username, role, banned, enabled_apis, updated_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role), banned = VALUES(banned), enabled_apis = VALUES(enabled_apis), updated_at = VALUES(updated_at)',
};
