import { createHash } from 'crypto';

import {
  type AdminUserItem,
  type AdminUserPage,
  type AdminUserQuery,
  adminUserLoginProvider,
} from '@/features/admin/lib/user-query';
import { OAUTH_PROVIDERS } from '@/lib/oauth-identity';
import { normalizeUsername } from '@/lib/username';

export type AdminUserStorageQuery = AdminUserQuery & {
  ownerUsername: string;
  operatorUsername: string;
  usernames?: string[];
  excluded?: string[];
  inactiveBefore?: number;
};
export type AdminUserRow = {
  username: string;
  role: AdminUserItem['role'];
  banned: number | string;
  tags: string | string[] | null;
  enabledApis: string | string[] | null;
  nickname: string | null;
  lastActiveAt: number | string | null;
  inviteCode: string | null;
  loginProviders: string | string[] | null;
  sort_key: number | string;
};

export function adminUserStatements(
  dialect: 'sqlite' | 'mysql',
  query: AdminUserStorageQuery,
) {
  const mysql = dialect === 'mysql';
  const binary = (expression: string) =>
    mysql ? `CAST(${expression} AS BINARY)` : `${expression} COLLATE BINARY`;
  const owner = normalizeUsername(query.ownerUsername);
  const operator = normalizeUsername(query.operatorUsername);
  const tags = mysql
    ? `(SELECT JSON_ARRAYAGG(g.group_name) OVER (ORDER BY g.position, g.group_name ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) FROM user_group_members g WHERE g.username = n.username LIMIT 1)`
    : `(SELECT json_group_array(group_name) FROM (SELECT group_name FROM user_group_members g WHERE g.username = n.username ORDER BY position))`;
  // 先按用户名聚合再连接，避免逐行子查询扫描身份表（唯一键以 provider 开头）
  const loginProviders = mysql
    ? 'SELECT username, JSON_ARRAYAGG(provider) AS providers FROM oauth_identities GROUP BY username'
    : 'SELECT username, json_group_array(provider) AS providers FROM oauth_identities GROUP BY username';
  const accessFilters: string[] = [];
  const accessParams: (string | number)[] = [];
  if (query.role && query.role !== 'all') {
    accessFilters.push(query.role === 'banned' ? 'x.banned = ?' : 'x.role = ?');
    accessParams.push(query.role === 'banned' ? 1 : query.role);
  }
  const names = accessFilters.length
    ? `SELECT x.username FROM user_access x JOIN users u ON u.username = x.username WHERE ${accessFilters.join(' AND ')}`
    : 'SELECT username FROM users';
  const cte = `WITH names AS (
    ${names}
    UNION SELECT ? WHERE ? <> ''
  ), base AS (
    SELECT n.username,
      CASE WHEN n.username = ? THEN 'owner' ELSE COALESCE(m.role, 'user') END AS role,
      CASE WHEN n.username = ? THEN 0 ELSE COALESCE(m.banned, 0) END AS banned,
      ${tags} AS tags, m.enabled_apis AS enabledApis,
      p.nickname, p.nickname_norm, a.last_login_at AS lastActiveAt,
      i.code AS inviteCode, o.providers AS loginProviders
    FROM names n LEFT JOIN user_access m ON m.username = n.username
    LEFT JOIN user_profiles p ON p.username = n.username
    LEFT JOIN user_login_activity a ON a.username = n.username
    LEFT JOIN invite_code_redemptions i ON i.username = n.username
    LEFT JOIN (${loginProviders}) o ON o.username = n.username
  ), ranked AS (
    SELECT base.*, ${query.sort === 'username' ? '0' : query.sort === 'activeAsc' || query.sort === 'activeDesc' ? 'COALESCE(lastActiveAt, 0)' : "CASE WHEN username = ? THEN 0 WHEN role = 'owner' THEN 1 WHEN role = 'admin' THEN 2 ELSE 3 END"} AS sort_key FROM base
  )`;
  const params: (string | number)[] = [
    ...accessParams,
    owner,
    owner,
    owner,
    owner,
  ];
  if (!query.sort || query.sort === 'priority') params.push(operator);
  const where: string[] = ['1 = 1'];
  if (query.q) {
    // Search is literal; '%' and '_' never become wildcard operators.
    // 邀请码只做整码匹配，避免普通的用户名搜索混入无关结果
    where.push(
      mysql
        ? `(LOCATE(CAST(? AS BINARY), CAST(LOWER(username) AS BINARY)) > 0 OR LOCATE(CAST(? AS BINARY), CAST(COALESCE(nickname_norm, '') AS BINARY)) > 0 OR CAST(LOWER(inviteCode) AS BINARY) = CAST(? AS BINARY))`
        : `(instr(LOWER(username), ?) > 0 OR instr(COALESCE(nickname_norm, ''), ?) > 0 OR LOWER(inviteCode) = ?)`,
    );
    params.push(query.q, query.q, query.q);
  }
  if (query.role && query.role !== 'all') {
    where.push(query.role === 'banned' ? 'banned = ?' : 'role = ?');
    params.push(query.role === 'banned' ? 1 : query.role);
  }
  const provider = adminUserLoginProvider(query.login);
  if (provider) {
    where.push(
      'EXISTS (SELECT 1 FROM oauth_identities oi WHERE oi.username = ranked.username AND oi.provider = ?)',
    );
    params.push(provider);
  } else if (query.login === 'none' || query.login === 'any') {
    where.push(
      `${query.login === 'none' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM oauth_identities oi WHERE oi.username = ranked.username)`,
    );
  }
  if (query.ungrouped) {
    where.push(
      'NOT EXISTS (SELECT 1 FROM user_group_members g WHERE g.username = ranked.username)',
    );
  }
  if (query.group) {
    where.push(
      'EXISTS (SELECT 1 FROM user_group_members g WHERE g.username = ranked.username AND g.group_name = ?)',
    );
    params.push(query.group);
  }
  for (const [values, negative] of [
    [query.usernames, false],
    [query.excluded, true],
  ] as const) {
    if (values === undefined || (negative && values.length === 0)) continue;
    if (!values.length) {
      where.push('1 = 0');
      continue;
    }
    const list = JSON.stringify([...new Set(values.map(normalizeUsername))]);
    const table = mysql
      ? `JSON_TABLE(?, '$[*]' COLUMNS(value VARCHAR(191) PATH '$')) selection`
      : `json_each(?) selection`;
    where.push(
      `${binary('username')} ${negative ? 'NOT IN' : 'IN'} (SELECT ${binary('selection.value')} FROM ${table})`,
    );
    params.push(list);
  }
  if (query.inactiveBefore !== undefined) {
    where.push(
      "role = 'user' AND username <> ? AND lastActiveAt > 0 AND lastActiveAt <= ?",
    );
    params.push(operator, query.inactiveBefore);
  }
  const scope = createHash('sha256')
    .update(
      JSON.stringify([
        query.q || '',
        query.role || 'all',
        query.login || 'all',
        query.group || '',
        query.ungrouped || false,
        query.sort || 'priority',
        owner,
        operator,
        query.inactiveBefore ?? null,
      ]),
    )
    .digest('hex');
  const count = `${cte} SELECT COUNT(*) AS total FROM ranked WHERE ${where.join(' AND ')}`;
  const countParams = [...params];
  if (query.cursor) {
    let cursor: unknown;
    try {
      cursor = JSON.parse(
        Buffer.from(query.cursor, 'base64url').toString('utf8'),
      );
    } catch {
      throw new Error('用户游标无效');
    }
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 3 ||
      cursor[0] !== scope ||
      !Number.isSafeInteger(cursor[1]) ||
      typeof cursor[2] !== 'string' ||
      cursor[2].length > 191
    )
      throw new Error('用户游标无效');
    where.push(
      `(sort_key ${query.sort === 'activeDesc' ? '<' : '>'} ? OR (sort_key = ? AND ${binary('username')} > ${binary('?')}))`,
    );
    params.push(cursor[1], cursor[1], cursor[2]);
  }
  const limit = query.limit ?? 50;
  const rows = `${cte} SELECT * FROM ranked WHERE ${where.join(' AND ')} ORDER BY sort_key ${query.sort === 'activeDesc' ? 'DESC' : 'ASC'}, ${binary('username')} ASC LIMIT ${limit + 1}`;
  return { count, countParams, rows, params, scope, limit };
}

function stringList(value: AdminUserRow['tags']): string[] | undefined {
  if (value === null) return undefined;
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : undefined;
}

function loginProviderList(value: AdminUserRow['loginProviders']) {
  const providers = new Set(stringList(value));
  return OAUTH_PROVIDERS.filter((provider) => providers.has(provider));
}

export function adminUserPage(
  rows: AdminUserRow[],
  total: number,
  scope: string,
  limit: number,
): AdminUserPage {
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return {
    items: selected.map((row) => ({
      username: row.username,
      role: row.role,
      banned: Number(row.banned) === 1,
      tags: stringList(row.tags),
      enabledApis: stringList(row.enabledApis),
      nickname: row.nickname,
      lastActiveAt: row.lastActiveAt === null ? null : Number(row.lastActiveAt),
      inviteCode: row.inviteCode ?? null,
      loginProviders: loginProviderList(row.loginProviders),
    })),
    total,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify([scope, Number(last.sort_key), last.username]),
          ).toString('base64url')
        : null,
  };
}
