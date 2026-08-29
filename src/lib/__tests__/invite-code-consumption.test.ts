/** @jest-environment node */

import type { AdminConfig } from '@/types/admin';

const mockGetConfigForRead = jest.fn();
const mockReserveInviteCodeUse = jest.fn();
const mockReleaseInviteCodeUse = jest.fn();

jest.mock('@/lib/config', () => ({
  getConfigForRead: (...args: unknown[]) => mockGetConfigForRead(...args),
}));

jest.mock('@/lib/db', () => ({
  db: {
    reserveInviteCodeUse: (...args: unknown[]) =>
      mockReserveInviteCodeUse(...args),
    releaseInviteCodeUse: (...args: unknown[]) =>
      mockReleaseInviteCodeUse(...args),
  },
}));

import type { InviteCode } from '@/features/admin/services/inviteCodes';
import {
  releaseInviteCode,
  reserveInviteCode,
} from '@/lib/invite-code-consumption.server';

const FUTURE = Date.now() + 86_400_000;

function makeConfig(inviteCodes: InviteCode[]): AdminConfig {
  return {
    UserConfig: { Users: [], InviteCodes: inviteCodes },
  } as unknown as AdminConfig;
}

function limitedCode(overrides: Partial<InviteCode> = {}): InviteCode {
  return {
    code: 'LIMITED',
    createdAt: 0,
    expiresAt: FUTURE,
    createdBy: 'admin',
    maxUses: 3,
    usedCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReserveInviteCodeUse.mockResolvedValue(true);
  mockReleaseInviteCodeUse.mockResolvedValue(undefined);
});

describe('reserveInviteCode', () => {
  it('占用有限次数码时把上限与历史用量交给数据库', async () => {
    mockGetConfigForRead.mockResolvedValue(makeConfig([limitedCode()]));

    await expect(reserveInviteCode('limited')).resolves.toBe(true);
    expect(mockReserveInviteCodeUse).toHaveBeenCalledWith('LIMITED', 3, 0);
  });

  it('配置里的历史用量作为数据库行的种子值', async () => {
    mockGetConfigForRead.mockResolvedValue(
      makeConfig([limitedCode({ maxUses: 5, usedCount: 2 })]),
    );

    await expect(reserveInviteCode('LIMITED')).resolves.toBe(true);
    expect(mockReserveInviteCodeUse).toHaveBeenCalledWith('LIMITED', 5, 2);
  });

  it('不限次数码以 maxUses 为 0 占用', async () => {
    mockGetConfigForRead.mockResolvedValue(
      makeConfig([limitedCode({ maxUses: undefined, usedCount: undefined })]),
    );

    await expect(reserveInviteCode('LIMITED')).resolves.toBe(true);
    expect(mockReserveInviteCodeUse).toHaveBeenCalledWith('LIMITED', 0, 0);
  });

  it('空码直接失败且不读配置', async () => {
    await expect(reserveInviteCode('  ')).resolves.toBe(false);
    expect(mockGetConfigForRead).not.toHaveBeenCalled();
    expect(mockReserveInviteCodeUse).not.toHaveBeenCalled();
  });

  it('数据库判定名额已满时占用失败', async () => {
    mockGetConfigForRead.mockResolvedValue(
      makeConfig([limitedCode({ maxUses: 2 })]),
    );
    mockReserveInviteCodeUse.mockResolvedValue(false);

    await expect(reserveInviteCode('LIMITED')).resolves.toBe(false);
  });

  it('过期的码占用失败且不碰数据库', async () => {
    mockGetConfigForRead.mockResolvedValue(
      makeConfig([limitedCode({ expiresAt: Date.now() - 1 })]),
    );

    await expect(reserveInviteCode('LIMITED')).resolves.toBe(false);
    expect(mockReserveInviteCodeUse).not.toHaveBeenCalled();
  });

  it('不存在的码占用失败且不碰数据库', async () => {
    mockGetConfigForRead.mockResolvedValue(makeConfig([limitedCode()]));

    await expect(reserveInviteCode('NOPE')).resolves.toBe(false);
    expect(mockReserveInviteCodeUse).not.toHaveBeenCalled();
  });

  it('并发占用只由数据库裁决，配置不参与记账', async () => {
    mockGetConfigForRead.mockResolvedValue(
      makeConfig([limitedCode({ maxUses: 2 })]),
    );
    mockReserveInviteCodeUse
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const results = await Promise.all([
      reserveInviteCode('LIMITED'),
      reserveInviteCode('LIMITED'),
      reserveInviteCode('LIMITED'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(2);
  });

  it('数据库报错向上抛出', async () => {
    mockGetConfigForRead.mockResolvedValue(makeConfig([limitedCode()]));
    mockReserveInviteCodeUse.mockRejectedValue(new Error('storage down'));

    await expect(reserveInviteCode('LIMITED')).rejects.toThrow('storage down');
  });
});

describe('releaseInviteCode', () => {
  it('回滚已占用的次数', async () => {
    await releaseInviteCode('limited');
    expect(mockReleaseInviteCodeUse).toHaveBeenCalledWith('LIMITED');
  });

  it('空码静默返回', async () => {
    await releaseInviteCode('  ');
    expect(mockReleaseInviteCodeUse).not.toHaveBeenCalled();
  });

  it('回滚不读配置', async () => {
    await releaseInviteCode('LIMITED');
    expect(mockGetConfigForRead).not.toHaveBeenCalled();
  });

  it('数据库报错不抛出', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockReleaseInviteCodeUse.mockRejectedValue(new Error('storage down'));

    await expect(releaseInviteCode('LIMITED')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
