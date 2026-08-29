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

  const run = (inactiveDays: number, includeNeverActive = false) =>
    findInactiveUsers({
      users,
      lastActiveAt,
      inactiveDays,
      operatorUsername: 'operator',
      includeNeverActive,
      now: NOW,
    });

  it('豁免 owner 与 admin', () => {
    const matched = run(90).map((c) => c.username);
    expect(matched).not.toContain('boss');
    expect(matched).not.toContain('helper');
  });

  it('默认跳过无活跃记录的用户', () => {
    expect(run(1).map((c) => c.username)).not.toContain('never');
  });

  it('includeNeverActive 时纳入无活跃记录的用户', () => {
    const matched = run(90, true);
    expect(matched.map((c) => c.username)).toEqual(['stale', 'never']);
  });

  it('从未活跃的用户不带天数，且不受阈值影响', () => {
    const matched = run(MAX_INACTIVE_DAYS, true);
    expect(matched).toEqual([
      { username: 'never', lastActiveAt: null, inactiveDays: null },
    ]);
  });

  it('从未活跃的用户排在有记录的用户之后', () => {
    expect(run(1, true).map((c) => c.username)).toEqual([
      'stale',
      'fresh',
      'never',
    ]);
  });

  it('includeNeverActive 不放宽 owner/admin 与操作者豁免', () => {
    const noRecordUsers = [
      { username: 'boss2', role: 'owner' as const },
      { username: 'helper2', role: 'admin' as const },
      { username: 'operator', role: 'user' as const },
    ];
    expect(
      findInactiveUsers({
        users: noRecordUsers,
        lastActiveAt: {},
        inactiveDays: 90,
        operatorUsername: 'operator',
        includeNeverActive: true,
        now: NOW,
      }),
    ).toEqual([]);
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

  it('从未活跃的候选者可以被删除', () => {
    const neverActive = [
      { username: 'never', lastActiveAt: null, inactiveDays: null },
    ];
    expect(resolveConfirmedDeletions(neverActive, ['never'])).toEqual([
      'never',
    ]);
  });
});
