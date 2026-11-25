import {
  adminUserLoginProvider,
  parseAdminUserQuery,
} from '@/features/admin/lib/user-query';
import { OAUTH_PROVIDERS } from '@/lib/oauth-identity';

it('defaults each independent dimension to all', () => {
  expect(parseAdminUserQuery({})).toMatchObject({
    role: 'all',
    login: 'all',
  });
});

it.each([
  'all',
  'none',
  'any',
  ...OAUTH_PROVIDERS.map((provider) => `provider:${provider}`),
])('accepts login %s combined with role, search and group', (login) => {
  expect(
    parseAdminUserQuery({
      q: ' ALICE ',
      role: 'admin',
      login,
      group: 'VIP',
    }),
  ).toMatchObject({
    q: 'alice',
    role: 'admin',
    login,
    group: 'VIP',
  });
});

it('extracts only provider-specific login filters', () => {
  expect(adminUserLoginProvider('provider:linuxdo')).toBe('linuxdo');
  expect(adminUserLoginProvider('any')).toBeNull();
  expect(adminUserLoginProvider('none')).toBeNull();
});

it.each([
  { role: 'owner' },
  { role: null },
  { role: ['admin'] },
  { ungrouped: 'yes' },
  { ungrouped: 1 },
  { ungrouped: null },
  { ungrouped: true, group: 'VIP' },
  { ungrouped: 'true', group: 'VIP' },
  { login: 'provider:unknown' },
  { login: 'user' },
  { login: null },
  { filter: 'all' },
  { filter: 'provider:linuxdo' },
])('rejects invalid or legacy dimensions: %j', (query) => {
  expect(() => parseAdminUserQuery(query)).toThrow('用户查询参数错误');
});

it.each([true, 'true', false, 'false'])(
  'parses ungrouped=%s without reserving group names',
  (ungrouped) => {
    expect(parseAdminUserQuery({ role: 'banned', ungrouped })).toMatchObject({
      role: 'banned',
      ungrouped: ungrouped === true || ungrouped === 'true',
    });
  },
);
it.each(['ungrouped', '未分组', 'group:VIP'])(
  'accepts literal group name %s',
  (group) => {
    expect(parseAdminUserQuery({ group })).toMatchObject({
      group,
      ungrouped: false,
    });
  },
);
