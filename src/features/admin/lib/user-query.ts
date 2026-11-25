import { type OAuthProvider, OAUTH_PROVIDERS } from '@/lib/oauth-identity';
import type { AdminConfig } from '@/types/admin';

export const ADMIN_USER_PAGE_SIZE = 50;
export const ADMIN_USER_SORTS = [
  'priority',
  'username',
  'activeDesc',
  'activeAsc',
] as const;
const ADMIN_USER_ROLES = ['all', 'admin', 'user', 'banned'] as const;
export type AdminUserLogin =
  | 'all'
  | 'none'
  | 'any'
  | `provider:${OAuthProvider}`;
const ADMIN_USER_LOGINS: readonly string[] = [
  'all',
  'none',
  'any',
  ...OAUTH_PROVIDERS.map((provider) => `provider:${provider}`),
];
export type AdminUserFilter = {
  q?: string;
  role?: (typeof ADMIN_USER_ROLES)[number];
  login?: AdminUserLogin;
  group?: string;
  ungrouped?: boolean;
};

export function adminUserLoginProvider(
  login: AdminUserFilter['login'],
): OAuthProvider | null {
  return login?.startsWith('provider:')
    ? (login.slice('provider:'.length) as OAuthProvider)
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
    role = 'all',
    login = 'all',
    group = '',
    ungrouped = false,
    sort = 'priority',
    cursor,
    limit = ADMIN_USER_PAGE_SIZE,
  } = value;
  if (
    typeof q !== 'string' ||
    q.length > 200 ||
    typeof group !== 'string' ||
    group.length > 200 ||
    'filter' in value ||
    (typeof ungrouped !== 'boolean' &&
      ungrouped !== 'true' &&
      ungrouped !== 'false') ||
    ((ungrouped === true || ungrouped === 'true') && group !== '') ||
    !ADMIN_USER_ROLES.includes(role as (typeof ADMIN_USER_ROLES)[number]) ||
    !ADMIN_USER_LOGINS.includes(login as string) ||
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
    role: role as AdminUserFilter['role'],
    login: login as AdminUserFilter['login'],
    group,
    ungrouped: ungrouped === true || ungrouped === 'true',
    sort: sort as AdminUserQuery['sort'],
    cursor: cursor as string | undefined,
    limit: Number(limit),
  };
}
