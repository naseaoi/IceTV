import type { AdminUserSelection } from '@/features/admin/lib/user-query';
import { parseAdminUserQuery } from '@/features/admin/lib/user-query';
import type { AdminUserStorageQuery } from '@/features/admin/services/userQueryStorage';
import { db } from '@/lib/db';
import { getOwnerUsername } from '@/lib/env.server';
import { normalizeUsername } from '@/lib/username';

export function selectionQuery(
  value: unknown,
  operatorUsername: string,
): AdminUserStorageQuery {
  if (!value || typeof value !== 'object') throw new Error('缺少用户选择条件');
  const selection = value as AdminUserSelection;
  const names =
    selection.mode === 'explicit'
      ? selection.usernames
      : selection.mode === 'all'
        ? selection.excluded
        : null;
  if (
    !Array.isArray(names) ||
    names.length > 10000 ||
    names.some(
      (name) => typeof name !== 'string' || !name.trim() || name.length > 64,
    )
  )
    throw new Error('用户选择条件错误');
  if (
    selection.mode === 'all' &&
    (!selection.filter || typeof selection.filter !== 'object')
  )
    throw new Error('缺少用户筛选条件');
  const filter = parseAdminUserQuery(
    selection.mode === 'all' ? selection.filter : {},
  );
  return {
    q: filter.q,
    filter: filter.filter,
    group: filter.group,
    sort: 'username',
    limit: 100,
    ownerUsername: getOwnerUsername() || '',
    operatorUsername: normalizeUsername(operatorUsername),
    ...(selection.mode === 'explicit'
      ? { usernames: names.map(normalizeUsername) }
      : { excluded: names.map(normalizeUsername) }),
  };
}

export async function matchingUsernames(
  query: AdminUserStorageQuery,
): Promise<string[]> {
  const usernames: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await db.getAdminUserPage({ ...query, cursor });
    usernames.push(...page.items.map((user) => user.username));
    cursor = page.nextCursor || undefined;
  } while (cursor);
  return usernames;
}
