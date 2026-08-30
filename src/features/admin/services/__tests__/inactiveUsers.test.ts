import {
  findInactiveUsers,
  MAX_INACTIVE_DAYS,
  parseInactiveDays,
  resolveConfirmedDeletions,
} from '@/features/admin/services/inactiveUsers';

const NOW = new Date('2026-08-29T12:00:00Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

const daysAgo = (days: number) => NOW - days * DAY_MS;

describe('parseInactiveDays', () => {
  it('拒绝非数字与越界值', () => {
    expect(parseInactiveDays('30')).toBeNull();
    expect(parseInactiveDays(undefined)).toBeNull();
    expect(parseInactiveDays(NaN)).toBeNull();
    expect(parseInactiveDays(Infinity)).toBeNull();
    expect(parseInactiveDays(0)).toBeNull();
    expect(parseInactiveDays(-5)).toBeNull();
    expect(parseInactiveDays(MAX_INACTIVE_DAYS + 1)).toBeNull();
  });

  it('接受范围内的值并向下取整', () => {
    expect(parseInactiveDays(1)).toBe(1);
    expect(parseInactiveDays(90.7)).toBe(90);
    expect(parseInactiveDays(MAX_INACTIVE_DAYS)).toBe(MAX_INACTIVE_DAYS);
  });
});

describe('findInactiveUsers', () => {
  const users = [
    { username: 'boss', role: 'owner' as const },
    { username: 'helper', role: 'admin' as const },
    { username: 'stale', role: 'user' as const },
    { username: 'fresh', role: 'user' as const },
    { username: 'never', role: 'user' as const },
    { username: 'operator', role: 'user' as const },
  ];

  const lastActiveAt = {
    boss: daysAgo(400),
    helper: daysAgo(300),
    stale: daysAgo(120),
    fresh: daysAgo(3),
    operator: daysAgo(200),
  };

  const run = (inactiveDays: number) =>
    findInactiveUsers({
      users,
      lastActiveAt,
      inactiveDays,
      operatorUsername: 'operator',
      now: NOW,
    });

  it('豁免 owner 与 admin', () => {
    const matched = run(90).map((c) => c.username);
    expect(matched).not.toContain('boss');
    expect(matched).not.toContain('helper');
  });

  it('跳过无活跃记录的用户', () => {
    expect(run(1).map((c) => c.username)).not.toContain('never');
  });

  it('跳过操作者自己', () => {
    expect(run(90).map((c) => c.username)).not.toContain('operator');
  });

  it('只匹配超过阈值的用户', () => {
    expect(run(90).map((c) => c.username)).toEqual(['stale']);
    expect(run(200)).toEqual([]);
  });

  it('按最后活跃时间升序返回并给出不活跃天数', () => {
    const matched = run(1);
    expect(matched.map((c) => c.username)).toEqual(['stale', 'fresh']);
    expect(matched[0].inactiveDays).toBe(120);
  });
});

describe('resolveConfirmedDeletions', () => {
  const candidates = [
    { username: 'a', lastActiveAt: daysAgo(100), inactiveDays: 100 },
    { username: 'b', lastActiveAt: daysAgo(99), inactiveDays: 99 },
  ];

  it('只删既在确认名单又仍符合阈值的用户', () => {
    expect(resolveConfirmedDeletions(candidates, ['a', 'b'])).toEqual([
      'a',
      'b',
    ]);
  });

  it('确认名单外的用户不会被删', () => {
    expect(resolveConfirmedDeletions(candidates, ['a'])).toEqual(['a']);
  });

  it('期间重新活跃而移出候选的用户会被跳过', () => {
    expect(resolveConfirmedDeletions([candidates[0]], ['a', 'b'])).toEqual([
      'a',
    ]);
  });

  it('名单外的陌生用户名被忽略', () => {
    expect(resolveConfirmedDeletions(candidates, ['zzz'])).toEqual([]);
  });
});
