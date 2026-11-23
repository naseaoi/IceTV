import { type OAuthProvider, OAUTH_PROVIDERS } from '@/lib/oauth-identity';
import type { AdminConfig } from '@/types/admin';

export const ADMIN_USER_PAGE_SIZE = 50;
export const ADMIN_USER_SORTS = [
  'priority',
  'username',
  'activeDesc',
  'activeAsc',
] as const;
export type AdminUserFilterValue =
  | 'all'
  | 'owner'
  | 'admin'
  | 'user'
  | 'banned'
  | `provider:${OAuthProvider}`;
const ADMIN_USER_FILTERS: readonly string[] = [
  'all',
  'owner',
  'admin',
  'user',
  'banned',
  ...OAUTH_PROVIDERS.map((provider) => `provider:${provider}`),
];
export type AdminUserFilter = {
  q?: string;
  filter?: AdminUserFilterValue;
  group?: string;
};

export function adminUserFilterProvider(
  filter: AdminUserFilter['filter'],
): OAuthProvider | null {
  return filter?.startsWith('provider:')
    ? (filter.slice('provider:'.length) as OAuthProvider)
    : null;
}
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
  loginProviders: OAuthProvider[];
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
    !ADMIN_USER_FILTERS.includes(filter as string) ||
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
