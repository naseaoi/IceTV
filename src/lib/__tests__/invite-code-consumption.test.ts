/** @jest-environment node */

import type { AdminConfig } from '@/types/admin';

const mockGetConfig = jest.fn();
const mockSaveConfig = jest.fn();
const mockInvalidateConfigCache = jest.fn();

jest.mock('@/lib/config', () => ({
  ConfigConflictError: class extends Error {},
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  invalidateConfigCache: (...args: unknown[]) =>
    mockInvalidateConfigCache(...args),
}));

import type { InviteCode } from '@/features/admin/services/inviteCodes';
import { ConfigConflictError } from '@/lib/config';
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

// getConfig 每次返回全新副本，与真实实现一致
function alwaysConfig(inviteCodes: InviteCode[]) {
  mockGetConfig.mockImplementation(async () =>
    makeConfig(inviteCodes.map((item) => ({ ...item }))),
  );
}

function savedInviteCodes(callIndex = 0): InviteCode[] {
  return (mockSaveConfig.mock.calls[callIndex][0] as AdminConfig).UserConfig
    .InviteCodes as InviteCode[];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveConfig.mockResolvedValue(undefined);
});

describe('reserveInviteCode', () => {
  it('占用有限次数码时累加 usedCount', async () => {
    mockGetConfig.mockResolvedValue(makeConfig([limitedCode()]));

    await expect(reserveInviteCode('limited')).resolves.toBe(true);
    expect(savedInviteCodes()[0].usedCount).toBe(1);
  });

  it('不限次数码占用成功但不记账', async () => {
    mockGetConfig.mockResolvedValue(
      makeConfig([limitedCode({ maxUses: undefined, usedCount: undefined })]),
    );

    await expect(reserveInviteCode('LIMITED')).resolves.toBe(true);
    expect(savedInviteCodes()[0].usedCount).toBeUndefined();
  });

  it('空码直接失败且不读配置', async () => {
    await expect(reserveInviteCode('  ')).resolves.toBe(false);
    expect(mockGetConfig).not.toHaveBeenCalled();
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('已用尽的码占用失败', async () => {
    mockGetConfig.mockResolvedValue(
      makeConfig([limitedCode({ maxUses: 2, usedCount: 2 })]),
    );

    await expect(reserveInviteCode('LIMITED')).resolves.toBe(false);
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('过期的码占用失败', async () => {
    mockGetConfig.mockResolvedValue(
      makeConfig([limitedCode({ expiresAt: Date.now() - 1 })]),
    );

    await expect(reserveInviteCode('LIMITED')).resolves.toBe(false);
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('不存在的码占用失败', async () => {
    mockGetConfig.mockResolvedValue(makeConfig([limitedCode()]));

    await expect(reserveInviteCode('NOPE')).resolves.toBe(false);
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('版本冲突后重读配置重试成功', async () => {
    alwaysConfig([limitedCode()]);
    mockSaveConfig
      .mockRejectedValueOnce(new ConfigConflictError())
      .mockResolvedValueOnce(undefined);

    await expect(reserveInviteCode('LIMITED')).resolves.toBe(true);
    expect(mockGetConfig).toHaveBeenCalledTimes(2);
    expect(savedInviteCodes(1)[0].usedCount).toBe(1);
  });

  it('冲突重试前失效配置缓存，避免重读到同一份旧配置', async () => {
    alwaysConfig([limitedCode()]);
    mockSaveConfig
      .mockRejectedValueOnce(new ConfigConflictError())
      .mockResolvedValueOnce(undefined);

    await expect(reserveInviteCode('LIMITED')).resolves.toBe(true);
    expect(mockInvalidateConfigCache).toHaveBeenCalledTimes(1);
  });

  it('重试期间码被用尽则失败', async () => {
    mockGetConfig
      .mockResolvedValueOnce(makeConfig([limitedCode({ maxUses: 1 })]))
      .mockResolvedValueOnce(
        makeConfig([limitedCode({ maxUses: 1, usedCount: 1 })]),
      );
    mockSaveConfig.mockRejectedValueOnce(new ConfigConflictError());

    await expect(reserveInviteCode('LIMITED')).resolves.toBe(false);
    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
  });

  it('持续冲突耗尽重试次数后失败', async () => {
    alwaysConfig([limitedCode({ maxUses: 99 })]);
    mockSaveConfig.mockRejectedValue(new ConfigConflictError());

    await expect(reserveInviteCode('LIMITED')).resolves.toBe(false);
    expect(mockSaveConfig).toHaveBeenCalledTimes(5);
  });

  it('非冲突错误向上抛出', async () => {
    mockGetConfig.mockResolvedValue(makeConfig([limitedCode()]));
    mockSaveConfig.mockRejectedValue(new Error('storage down'));

    await expect(reserveInviteCode('LIMITED')).rejects.toThrow('storage down');
  });
});

describe('releaseInviteCode', () => {
  it('回滚已占用的次数', async () => {
    mockGetConfig.mockResolvedValue(
      makeConfig([limitedCode({ usedCount: 2 })]),
    );

    await releaseInviteCode('limited');
    expect(savedInviteCodes()[0].usedCount).toBe(1);
  });

  it('不限次数码无需回滚', async () => {
    mockGetConfig.mockResolvedValue(
      makeConfig([limitedCode({ maxUses: undefined, usedCount: undefined })]),
    );

    await releaseInviteCode('LIMITED');
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('未占用过时不会减到负数', async () => {
    mockGetConfig.mockResolvedValue(
      makeConfig([limitedCode({ usedCount: 0 })]),
    );

    await releaseInviteCode('LIMITED');
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('码已被删除时静默返回', async () => {
    mockGetConfig.mockResolvedValue(makeConfig([]));

    await releaseInviteCode('LIMITED');
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('版本冲突后重试成功', async () => {
    alwaysConfig([limitedCode({ usedCount: 2 })]);
    mockSaveConfig
      .mockRejectedValueOnce(new ConfigConflictError())
      .mockResolvedValueOnce(undefined);

    await releaseInviteCode('LIMITED');
    expect(mockSaveConfig).toHaveBeenCalledTimes(2);
    expect(savedInviteCodes(1)[0].usedCount).toBe(1);
  });

  it('非冲突错误不抛出', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetConfig.mockResolvedValue(
      makeConfig([limitedCode({ usedCount: 1 })]),
    );
    mockSaveConfig.mockRejectedValue(new Error('storage down'));

    await expect(releaseInviteCode('LIMITED')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
