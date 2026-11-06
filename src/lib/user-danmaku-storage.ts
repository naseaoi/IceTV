import type { UserDanmakuMode } from '@/lib/user-danmaku';
import { ADMIN_USER_DANMAKU_PAGE_SIZE } from '@/lib/user-danmaku';
import { normalizeUsername } from '@/lib/username';

export interface StoredUserDanmaku {
  id: string;
  episodeKey: string;
  username: string;
  timeMs: number;
  text: string;
  mode: UserDanmakuMode;
  color: string;
  createdAt: number;
}

export interface UserDanmakuCursor {
  createdAt: number;
  id: string;
}

export interface UserDanmakuQuery {
  cursor?: UserDanmakuCursor;
  q?: string;
  username?: string;
}

export const USER_DANMAKU_COLUMNS = [
  'id',
  'episode_key',
  'username',
  'time_ms',
  'text',
  'mode',
  'color',
  'created_at',
];
export const USER_DANMAKU_INSERT = `INSERT INTO user_danmaku (${USER_DANMAKU_COLUMNS.join(', ')}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
export const USER_DANMAKU_PROJECTION =
  'id, episode_key AS episodeKey, username, time_ms AS timeMs, text, mode, color, created_at AS createdAt';

export function userDanmakuValues(item: StoredUserDanmaku) {
  return [
    item.id,
    item.episodeKey,
    normalizeUsername(item.username),
    item.timeMs,
    item.text,
    item.mode,
    item.color,
    item.createdAt,
  ];
}

export function userDanmakuSchema(dialect: 'sqlite' | 'mysql'): string[] {
  const mysql = dialect === 'mysql';
  const indexes = [
    ['episode', 'episode_key, created_at'],
    ['username', 'username, created_at'],
    ['page', 'created_at, id'],
  ];
  return [
    `CREATE TABLE IF NOT EXISTS user_danmaku (
      id ${mysql ? 'VARCHAR(36)' : 'TEXT'} NOT NULL PRIMARY KEY,
      episode_key ${mysql ? 'VARCHAR(256)' : 'TEXT'} NOT NULL,
      username ${mysql ? 'VARCHAR(191)' : 'TEXT'} NOT NULL,
      time_ms ${mysql ? 'INT' : 'INTEGER'} NOT NULL,
      text ${mysql ? 'VARCHAR(400)' : 'TEXT'} NOT NULL,
      mode ${mysql ? 'TINYINT' : 'INTEGER'} NOT NULL,
      color ${mysql ? 'VARCHAR(7)' : 'TEXT'} NOT NULL,
      created_at ${mysql ? 'BIGINT' : 'INTEGER'} NOT NULL
      ${mysql ? indexes.map(([name, columns]) => `, KEY idx_user_danmaku_${name} (${columns})`).join('') : ''}
    )${mysql ? ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : ''}`,
    ...(mysql
      ? []
      : indexes.map(
          ([name, columns]) =>
            `CREATE INDEX IF NOT EXISTS idx_user_danmaku_${name} ON user_danmaku (${columns})`,
        )),
  ];
}

export function userDanmakuPageSql(query: UserDanmakuQuery) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (query.cursor) {
    where.push('(created_at < ? OR (created_at = ? AND id < ?))');
    params.push(
      query.cursor.createdAt,
      query.cursor.createdAt,
      query.cursor.id,
    );
  }
  if (query.q) {
    // 显式转义符使两侧均按字面量搜索 %、_ 与反斜线。
    const pattern = `%${query.q.replace(/[!%_]/g, '!$&')}%`;
    where.push(
      "(LOWER(text) LIKE LOWER(?) ESCAPE '!' OR LOWER(username) LIKE LOWER(?) ESCAPE '!')",
    );
    params.push(pattern, pattern);
  }
  if (query.username) {
    where.push('username = ?');
    params.push(normalizeUsername(query.username));
  }
  return {
    sql: `SELECT ${USER_DANMAKU_PROJECTION} FROM user_danmaku ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ${ADMIN_USER_DANMAKU_PAGE_SIZE + 1}`,
    params,
  };
}

export function storedUserDanmaku(row: StoredUserDanmaku): StoredUserDanmaku {
  return {
    ...row,
    timeMs: Number(row.timeMs),
    createdAt: Number(row.createdAt),
    mode: Number(row.mode) as UserDanmakuMode,
  };
}
