const mockPurgeInviteCodes = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    purgeInviteCodes: (...args: unknown[]) => mockPurgeInviteCodes(...args),
  },
}));

import {
  cleanupInviteCodes,
  INVITE_CODE_RETENTION_DAYS,
} from './invite-code-retention';

describe('cleanupInviteCodes', () => {
  beforeEach(() => {
    mockPurgeInviteCodes.mockReset();
  });

  it('只删除过期超过保留期的邀请码', async () => {
    mockPurgeInviteCodes.mockResolvedValue(0);
    const now = 1_000_000_000_000;
    await cleanupInviteCodes(now);
    expect(mockPurgeInviteCodes).toHaveBeenCalledWith({
      expiredBefore: now - INVITE_CODE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      includeExhausted: false,
    });
  });

  it('清理失败不影响后续维护任务', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockPurgeInviteCodes.mockRejectedValue(new Error('db down'));
    await expect(cleanupInviteCodes()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
