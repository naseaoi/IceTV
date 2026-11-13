import type { AdminConfig } from '@/types/admin';

export const ADMIN_USER_PAGE_SIZE = 50;
export const ADMIN_USER_SORTS = [
  'priority',
  'username',
  'activeDesc',
  'activeAsc',
] as const;
export type AdminUserFilter = {
  q?: string;
  filter?: 'all' | 'owner' | 'admin' | 'user' | 'banned';
  group?: string;
};
export type AdminUserQuery = AdminUserFilter & {
  sort?: (typeof ADMIN_USER_SORTS)[number];
  cursor?: string;
  limit?: number;
};
export type AdminUserItem = NonNullable<
  AdminConfig['UserConfig']['Users']
>[number] & {
  nickname: string | null;
  lastActiveAt: number | null;
  inviteCode: string | null;
};
export type AdminUserPage = {
  items: AdminUserItem[];
  total: number;
  nextCursor: string | null;
};
export type AdminUserSelection =
  | { mode: 'explicit'; usernames: string[] }
  | { mode: 'all'; filter: AdminUserFilter; excluded: string[] };

export function parseAdminUserQuery(
  value: Record<string, unknown>,
): AdminUserQuery {
  const {
    q = '',
    filter = 'all',
    group = '',
    sort = 'priority',
    cursor,
    limit = ADMIN_USER_PAGE_SIZE,
  } = value;
  if (
    typeof q !== 'string' ||
    q.length > 200 ||
    typeof group !== 'string' ||
    group.length > 200 ||
    !['all', 'owner', 'admin', 'user', 'banned'].includes(filter as string) ||
    !ADMIN_USER_SORTS.includes(sort as (typeof ADMIN_USER_SORTS)[number]) ||
    (cursor !== undefined &&
      (typeof cursor !== 'string' || cursor.length > 2048)) ||
    !Number.isInteger(Number(limit)) ||
    Number(limit) < 1 ||
    Number(limit) > 100
  )
    throw new Error('用户查询参数错误');
  return {
    q: q.normalize('NFKC').trim().toLowerCase(),
    filter: filter as AdminUserFilter['filter'],
    group,
    sort: sort as AdminUserQuery['sort'],
    cursor: cursor as string | undefined,
    limit: Number(limit),
  };
}
