import { resolveSourceAccessRule } from '@/lib/source-access';

const groups = [
  { name: 'A', enabledApis: ['a1', 'shared'] },
  { name: 'B', enabledApis: ['b1', 'shared'] },
  { name: 'empty', enabledApis: [] },
];

describe('resolveSourceAccessRule', () => {
  it('个人配置整体覆盖用户组', () => {
    const rule = resolveSourceAccessRule(
      { enabledApis: ['own'], tags: ['A'] },
      groups,
    );
    expect(rule?.origin).toBe('user');
    expect([...(rule?.keys ?? [])]).toEqual(['own']);
  });

  it('多个用户组取并集', () => {
    const rule = resolveSourceAccessRule({ tags: ['A', 'B'] }, groups);
    expect(rule?.origin).toBe('group');
    expect([...(rule?.keys ?? [])].sort()).toEqual(['a1', 'b1', 'shared']);
  });

  it('无个人配置且用户组未限定源时不限制', () => {
    expect(resolveSourceAccessRule({ enabledApis: [] }, groups)).toBeNull();
    expect(resolveSourceAccessRule({ tags: ['empty'] }, groups)).toBeNull();
    expect(resolveSourceAccessRule({ tags: ['missing'] }, groups)).toBeNull();
  });
});
