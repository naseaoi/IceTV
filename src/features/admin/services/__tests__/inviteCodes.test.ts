import {
  type InviteCode,
  buildInviteCode,
  countActiveInviteCodes,
  CUSTOM_INVITE_CODE_MAX_LENGTH,
  findUsableInviteCode,
  getInviteCodeRemainingUses,
  isInviteCodeExhausted,
  isInviteCodeUsable,
  isValidCustomInviteCode,
  MAX_INVITE_MAX_USES,
  mergeInviteCodeUsage,
  normalizeInviteCode,
  parseInviteMaxUses,
  sanitizeInviteCodes,
} from '@/features/admin/services/inviteCodes';

const NOW = 1_700_000_000_000;

function makeCode(overrides: Partial<InviteCode> = {}): InviteCode {
  return {
    code: 'WELCOME-2026',
    createdAt: NOW,
    expiresAt: NOW + 86_400_000,
    createdBy: 'admin',
    ...overrides,
  };
}

describe('自定义邀请码校验', () => {
  it('归一化为去空格大写', () => {
    expect(normalizeInviteCode('  welcome-2026 ')).toBe('WELCOME-2026');
  });

  it('接受字母数字下划线连字符', () => {
    expect(isValidCustomInviteCode('WELCOME')).toBe(true);
    expect(isValidCustomInviteCode('vip_2026')).toBe(true);
    expect(isValidCustomInviteCode('a-b-c1')).toBe(true);
  });

  it('拒绝过短、过长与非法字符', () => {
    expect(isValidCustomInviteCode('abc')).toBe(false);
    expect(
      isValidCustomInviteCode('A'.repeat(CUSTOM_INVITE_CODE_MAX_LENGTH + 1)),
    ).toBe(false);
    expect(isValidCustomInviteCode('code with space')).toBe(false);
    expect(isValidCustomInviteCode('邀请码abc')).toBe(false);
    expect(isValidCustomInviteCode('code@1')).toBe(false);
  });

  it('拒绝非字符串', () => {
    expect(isValidCustomInviteCode(undefined)).toBe(false);
    expect(isValidCustomInviteCode(12345678)).toBe(false);
  });
});

describe('parseInviteMaxUses', () => {
  it('留空与 0 视为不限次数', () => {
    expect(parseInviteMaxUses(undefined)).toBeUndefined();
    expect(parseInviteMaxUses(null)).toBeUndefined();
    expect(parseInviteMaxUses('')).toBeUndefined();
    expect(parseInviteMaxUses(0)).toBeUndefined();
  });

  it('接受范围内整数并向下取整', () => {
    expect(parseInviteMaxUses(1)).toBe(1);
    expect(parseInviteMaxUses(3.9)).toBe(3);
    expect(parseInviteMaxUses(MAX_INVITE_MAX_USES)).toBe(MAX_INVITE_MAX_USES);
  });

  it('拒绝超范围、负数与非数字', () => {
    expect(parseInviteMaxUses(MAX_INVITE_MAX_USES + 1)).toBeNull();
    expect(parseInviteMaxUses(-1)).toBeNull();
    expect(parseInviteMaxUses(Number.NaN)).toBeNull();
    expect(parseInviteMaxUses('5')).toBeNull();
  });
});

describe('邀请码次数状态', () => {
  it('不限次数的码永不用尽', () => {
    const code = makeCode({ usedCount: 999 });
    expect(isInviteCodeExhausted(code)).toBe(false);
    expect(getInviteCodeRemainingUses(code)).toBeNull();
  });

  it('用满次数即用尽', () => {
    expect(isInviteCodeExhausted(makeCode({ maxUses: 2, usedCount: 1 }))).toBe(
      false,
    );
    expect(isInviteCodeExhausted(makeCode({ maxUses: 2, usedCount: 2 }))).toBe(
      true,
    );
  });

  it('剩余次数不为负', () => {
    expect(getInviteCodeRemainingUses(makeCode({ maxUses: 3 }))).toBe(3);
    expect(
      getInviteCodeRemainingUses(makeCode({ maxUses: 3, usedCount: 1 })),
    ).toBe(2);
    expect(
      getInviteCodeRemainingUses(makeCode({ maxUses: 3, usedCount: 9 })),
    ).toBe(0);
  });

  it('过期或用尽都不可用', () => {
    expect(isInviteCodeUsable(makeCode(), NOW)).toBe(true);
    expect(isInviteCodeUsable(makeCode({ expiresAt: NOW - 1 }), NOW)).toBe(
      false,
    );
    expect(
      isInviteCodeUsable(makeCode({ maxUses: 1, usedCount: 1 }), NOW),
    ).toBe(false);
  });

  it('findUsableInviteCode 与 countActiveInviteCodes 排除用尽的码', () => {
    const codes = [
      makeCode({ code: 'ALIVE', maxUses: 2, usedCount: 1 }),
      makeCode({ code: 'USEDUP', maxUses: 1, usedCount: 1 }),
      makeCode({ code: 'GONE', expiresAt: NOW - 1 }),
    ];
    expect(findUsableInviteCode(codes, 'alive', NOW)?.code).toBe('ALIVE');
    expect(findUsableInviteCode(codes, 'usedup', NOW)).toBeNull();
    expect(countActiveInviteCodes(codes, NOW)).toBe(1);
  });
});

describe('buildInviteCode 次数字段', () => {
  it('传次数时初始化 usedCount', () => {
    const code = buildInviteCode({
      code: 'VIP_2026',
      validDays: 7,
      createdBy: 'admin',
      maxUses: 5,
      now: NOW,
    });
    expect(code).toMatchObject({ maxUses: 5, usedCount: 0 });
  });

  it('不传次数时不写入字段', () => {
    const code = buildInviteCode({
      code: 'VIP_2026',
      validDays: 7,
      createdBy: 'admin',
      now: NOW,
    });
    expect(code.maxUses).toBeUndefined();
    expect(code.usedCount).toBeUndefined();
  });
});

describe('mergeInviteCodeUsage', () => {
  it('用数据库用量覆盖配置里的旧值', () => {
    const codes = [makeCode({ code: 'LIMITED', maxUses: 3, usedCount: 1 })];
    const next = mergeInviteCodeUsage(codes, { LIMITED: 2 });
    expect(next[0].usedCount).toBe(2);
  });

  it('数据库缺行时回落到配置里的历史值', () => {
    const codes = [makeCode({ code: 'LIMITED', maxUses: 3, usedCount: 1 })];
    expect(mergeInviteCodeUsage(codes, {})[0].usedCount).toBe(1);
  });

  it('数据库和配置都没有时归零', () => {
    const codes = [makeCode({ code: 'LIMITED', maxUses: 3 })];
    expect(mergeInviteCodeUsage(codes, {})[0].usedCount).toBe(0);
  });

  it('用量为 0 时不被历史值顶替', () => {
    const codes = [makeCode({ code: 'LIMITED', maxUses: 3, usedCount: 5 })];
    expect(mergeInviteCodeUsage(codes, { LIMITED: 0 })[0].usedCount).toBe(0);
  });

  it('不限次数的码原样返回', () => {
    const codes = [makeCode({ code: 'FREE' })];
    expect(
      mergeInviteCodeUsage(codes, { FREE: 9 })[0].usedCount,
    ).toBeUndefined();
  });

  it('不修改原数组', () => {
    const codes = [makeCode({ code: 'LIMITED', maxUses: 3, usedCount: 1 })];
    mergeInviteCodeUsage(codes, { LIMITED: 2 });
    expect(codes[0].usedCount).toBe(1);
  });

  it('无邀请码时返回空数组', () => {
    expect(mergeInviteCodeUsage(undefined, {})).toEqual([]);
  });
});

describe('sanitizeInviteCodes 次数字段', () => {
  it('保留次数字段并向下取整钳到非负', () => {
    const [code] = sanitizeInviteCodes([
      { ...makeCode(), maxUses: 5.8, usedCount: -3 },
    ]);
    expect(code).toMatchObject({ maxUses: 5, usedCount: 0 });
  });

  it('maxUses 为 0 或非法时省略两个字段', () => {
    const [zero] = sanitizeInviteCodes([
      { ...makeCode(), maxUses: 0, usedCount: 2 },
    ]);
    expect(zero.maxUses).toBeUndefined();
    expect(zero.usedCount).toBeUndefined();

    const [bad] = sanitizeInviteCodes([
      { ...makeCode(), maxUses: 'many', usedCount: 2 },
    ]);
    expect(bad.maxUses).toBeUndefined();
    expect(bad.usedCount).toBeUndefined();
  });
});
