/** @jest-environment node */

const mockReserveInviteCodeUse = jest.fn();
const mockReleaseInviteCodeUse = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    reserveInviteCodeUse: (...args: unknown[]) =>
      mockReserveInviteCodeUse(...args),
    releaseInviteCodeUse: (...args: unknown[]) =>
      mockReleaseInviteCodeUse(...args),
  },
}));

import {
  releaseInviteCode,
  reserveInviteCode,
} from '@/lib/invite-code-consumption.server';

beforeEach(() => {
  jest.clearAllMocks();
  mockReserveInviteCodeUse.mockResolvedValue(true);
  mockReleaseInviteCodeUse.mockResolvedValue(undefined);
});

describe('邀请码原子消费', () => {
  it('归一化邀请码后由数据库判断有效期与用量', async () => {
    await expect(reserveInviteCode(' limited ')).resolves.toBe(true);
    expect(mockReserveInviteCodeUse).toHaveBeenCalledWith('LIMITED');
  });
  it('空码直接失败', async () => {
    await expect(reserveInviteCode(' ')).resolves.toBe(false);
    expect(mockReserveInviteCodeUse).not.toHaveBeenCalled();
  });
  it.each(['EXPIRED', 'EXHAUSTED', 'MISSING'])(
    '数据库拒绝 %s',
    async (code) => {
      mockReserveInviteCodeUse.mockResolvedValue(false);
      await expect(reserveInviteCode(code)).resolves.toBe(false);
    },
  );
  it('并发名额只由数据库裁决', async () => {
    mockReserveInviteCodeUse
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const results = await Promise.all(
      Array.from({ length: 3 }, () => reserveInviteCode('limited')),
    );
    expect(results.filter(Boolean)).toHaveLength(2);
  });
  it('存储错误向上传递', async () => {
    mockReserveInviteCodeUse.mockRejectedValue(new Error('storage down'));
    await expect(reserveInviteCode('limited')).rejects.toThrow('storage down');
  });
  it('回滚次数并归一化邀请码', async () => {
    await releaseInviteCode('limited');
    expect(mockReleaseInviteCodeUse).toHaveBeenCalledWith('LIMITED');
  });
  it('空码回滚直接返回', async () => {
    await releaseInviteCode(' ');
    expect(mockReleaseInviteCodeUse).not.toHaveBeenCalled();
  });
  it('回滚失败保留日志', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockReleaseInviteCodeUse.mockRejectedValue(new Error('storage down'));
    await expect(releaseInviteCode('limited')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
