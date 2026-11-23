import {
  adminUserFilterProvider,
  parseAdminUserQuery,
} from '@/features/admin/lib/user-query';

it('接受已知登录渠道筛选并拒绝未知渠道', () => {
  const query = parseAdminUserQuery({ filter: 'provider:linuxdo' });
  expect(query.filter).toBe('provider:linuxdo');
  expect(adminUserFilterProvider(query.filter)).toBe('linuxdo');
  expect(adminUserFilterProvider('banned')).toBeNull();
  expect(() => parseAdminUserQuery({ filter: 'provider:unknown' })).toThrow(
    '用户查询参数错误',
  );
});
