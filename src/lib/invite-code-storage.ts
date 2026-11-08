import {
  type InviteCode,
  INVITE_CODE_MAX_PAGE_SIZE,
  INVITE_CODE_PAGE_SIZE,
  MAX_INVITE_CODES,
  sanitizeInviteCodes,
} from '@/features/admin/services/inviteCodes';

export { INVITE_CODE_MAX_PAGE_SIZE, INVITE_CODE_PAGE_SIZE };
export type InviteCodeFilter = 'all' | 'active' | 'expired' | 'exhausted';
export type InviteCodeQuery = {
  filter?: InviteCodeFilter;
  cursor?: string;
  limit?: number;
};
export type InviteCodePage = {
  items: InviteCode[];
  total: number;
  activeCount: number;
  inactiveCount: number;
  nextCursor: string | null;
};
export type InviteCodeCreateResult = 'created' | 'exists' | 'limit';
export type InviteCodeRow = {
  code: string;
  created_at: number | string;
  expires_at: number | string;
  created_by: string;
  max_uses: number | string | null;
  used_count: number | string;
};
export const INVITE_ACTIVE_SQL =
  'expires_at > ? AND (max_uses IS NULL OR used_count < max_uses)';
export const INVITE_EXHAUSTED_SQL =
  'max_uses IS NOT NULL AND used_count >= max_uses';
export const INVITE_INSERT_SQL =
  'INSERT INTO invite_codes (code, created_at, expires_at, created_by, max_uses, used_count) VALUES (?, ?, ?, ?, ?, ?)';
export { MAX_INVITE_CODES };

export type InviteCodePurge = {
  expiredBefore: number;
  includeExhausted: boolean;
};

export function invitePurgeStatement({
  expiredBefore,
  includeExhausted,
}: InviteCodePurge) {
  return {
    sql: `DELETE FROM invite_codes WHERE expires_at <= ?${
      includeExhausted ? ` OR (${INVITE_EXHAUSTED_SQL})` : ''
    }`,
    params: [expiredBefore],
  };
}

export function inviteValues(item: InviteCode): (string | number | null)[] {
  return [
    item.code,
    item.createdAt,
    item.expiresAt,
    item.createdBy,
    item.maxUses || null,
    item.usedCount || 0,
  ];
}

export function inviteFromRow(row: InviteCodeRow): InviteCode {
  return {
    code: row.code,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    createdBy: row.created_by,
    ...(row.max_uses === null ? {} : { maxUses: Number(row.max_uses) }),
    usedCount: Number(row.used_count),
  };
}

export function importedInviteCodes(
  value: unknown,
  usage: Record<string, number>,
): InviteCode[] {
  return sanitizeInviteCodes(value).map((item) => ({
    ...item,
    usedCount: Math.max(item.usedCount || 0, usage[item.code] || 0),
  }));
}

export function invitePageStatements(query: InviteCodeQuery, now = Date.now()) {
  const filter = query.filter || 'all';
  const limit = query.limit ?? INVITE_CODE_PAGE_SIZE;
  if (
    !['all', 'active', 'expired', 'exhausted'].includes(filter) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > INVITE_CODE_MAX_PAGE_SIZE
  ) {
    throw new Error('邀请码查询参数无效');
  }
  const where =
    filter === 'active'
      ? INVITE_ACTIVE_SQL
      : filter === 'expired'
        ? 'expires_at <= ?'
        : filter === 'exhausted'
          ? INVITE_EXHAUSTED_SQL
          : '1 = 1';
  const countParams: (string | number)[] =
    filter === 'active' || filter === 'expired' ? [now] : [];
  const params = [...countParams];
  let cursorWhere = '';
  if (query.cursor) {
    let cursor: unknown;
    try {
      cursor = JSON.parse(
        Buffer.from(query.cursor, 'base64url').toString('utf8'),
      );
    } catch {
      throw new Error('邀请码游标无效');
    }
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 3 ||
      cursor[0] !== filter ||
      !Number.isSafeInteger(cursor[1]) ||
      typeof cursor[2] !== 'string' ||
      cursor[2].length > 191
    ) {
      throw new Error('邀请码游标无效');
    }
    cursorWhere = ' AND (created_at < ? OR (created_at = ? AND code < ?))';
    params.push(cursor[1], cursor[1], cursor[2]);
  }
  return {
    count: `SELECT COUNT(*) AS total FROM invite_codes WHERE ${where}`,
    countParams,
    rows: `SELECT * FROM invite_codes WHERE ${where}${cursorWhere} ORDER BY created_at DESC, code DESC LIMIT ${limit + 1}`,
    params,
    limit,
    filter,
  };
}

export function invitePage(
  rows: InviteCodeRow[],
  total: number,
  activeCount: number,
  inactiveCount: number,
  query: InviteCodeQuery,
): InviteCodePage {
  const limit = query.limit ?? INVITE_CODE_PAGE_SIZE;
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return {
    items: selected.map(inviteFromRow),
    total,
    activeCount,
    inactiveCount,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify([
              query.filter || 'all',
              Number(last.created_at),
              last.code,
            ]),
          ).toString('base64url')
        : null,
  };
}
