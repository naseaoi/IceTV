/** @jest-environment node */

import type { AdminConfig } from '@/types/admin';

const mockGetConfig = jest.fn();
const mockSaveConfig = jest.fn();
const mockInvalidateConfigCache = jest.fn();
const callOrder: string[] = [];

jest.mock('@/lib/config', () => ({
  ConfigConflictError: class extends Error {},
  getConfig: (...args: unknown[]) => {
    callOrder.push('getConfig');
    return mockGetConfig(...args);
  },
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  invalidateConfigCache: (...args: unknown[]) => {
    callOrder.push('invalidateConfigCache');
    return mockInvalidateConfigCache(...args);
  },
}));

jest.mock('@/lib/db', () => ({
  db: {
    getUserAccess: jest.fn(),
    updateUserAccess: jest.fn(),
    deleteUser: jest.fn(),
    getAllUserLastActive: jest.fn(),
    createInviteCode: jest.fn(),
    deleteInviteCode: jest.fn(),
    getAdminUserPage: jest.fn(),
  },
}));

import { handleAdminUserAction } from '@/features/admin/services/userActions';
import { db } from '@/lib/db';

function makeConfig(usernames: string[]): AdminConfig {
  return {
    UserConfig: {
      Users: usernames.map((username) => ({ username, role: 'user' as const })),
    },
  } as unknown as AdminConfig;
}

beforeEach(() => {
  jest.clearAllMocks();
  callOrder.length = 0;
  mockSaveConfig.mockResolvedValue(undefined);
  (db.getUserAccess as jest.Mock).mockImplementation(
    async (username: string) => {
      const config = await mockGetConfig();
      return (
        config.UserConfig.Users?.find(
          (user: { username: string }) => user.username === username,
        ) || null
      );
    },
  );
  (db.updateUserAccess as jest.Mock).mockImplementation(
    async (names: string[]) => names.length,
  );
  (db.deleteUser as jest.Mock).mockResolvedValue(undefined);
  (db.getAllUserLastActive as jest.Mock).mockResolvedValue({});
});

describe('批量用户组服务端选择', () => {
  beforeEach(() => {
    const config = makeConfig(['owner', 'manager', 'operator', 'alice', 'bob']);
    config.UserConfig.Users![0].role = 'owner';
    config.UserConfig.Users![1].role = 'admin';
    config.UserConfig.Users![2].role = 'admin';
    config.UserConfig.Tags = [{ name: 'VIP', enabledApis: [] }];
    mockGetConfig.mockImplementation(async () =>
      JSON.parse(JSON.stringify(config)),
    );
    (db.getAdminUserPage as jest.Mock).mockResolvedValue({
      items: config.UserConfig.Users,
      total: 5,
      nextCursor: null,
    });
  });

  it.each([
    ['admin', 2, 3],
    ['owner', 3, 2],
  ] as const)(
    'applies %s exemptions and normalizes excluded names',
    async (role, affectedCount, skippedCount) => {
      const result = await handleAdminUserAction({
        operatorUsername: 'OPERATOR',
        operatorRole: role,
        body: {
          action: 'batchUpdateUserGroups',
          selection: { mode: 'all', filter: { q: ' a ' }, excluded: ['BOB'] },
          userGroups: ['VIP'],
          dryRun: true,
        },
      });
      expect(result.body).toEqual({ affectedCount, skippedCount });
      expect(db.getAdminUserPage).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'a',
          excluded: ['bob'],
          operatorUsername: 'operator',
        }),
      );
      expect(mockSaveConfig).not.toHaveBeenCalled();
    },
  );

  it('writes matching group changes through the guarded database transaction', async () => {
    const result = await handleAdminUserAction({
      operatorUsername: 'operator',
      operatorRole: 'admin',
      body: {
        action: 'batchUpdateUserGroups',
        selection: { mode: 'all', filter: {}, excluded: [] },
        userGroups: ['VIP'],
      },
    });
    expect(result.body).toEqual({
      ok: true,
      processedCount: 2,
      skippedCount: 3,
    });
    expect(callOrder).toEqual(['invalidateConfigCache', 'getConfig']);
    expect(db.getAdminUserPage).toHaveBeenCalledTimes(1);
    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(db.updateUserAccess).toHaveBeenCalledWith(
      ['alice', 'bob'],
      { tags: ['VIP'] },
      {
        operatorUsername: 'operator',
        operatorRole: 'admin',
        excludeSelf: true,
      },
    );
  });

  it('rejects malformed all-matching selectors instead of expanding to everyone', async () => {
    const result = await handleAdminUserAction({
      operatorUsername: 'operator',
      operatorRole: 'admin',
      body: {
        action: 'batchUpdateUserGroups',
        selection: { mode: 'all', excluded: [] },
        userGroups: ['VIP'],
      },
    });
    expect(result.status).toBe(400);
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });
});

describe('handleAdminUserAction 配置读取时机', () => {
  it.each(['previewInactiveUsers', 'deleteInactiveUsers'])(
    'rejects the legacy %s cleanup protocol',
    async (action) => {
      mockGetConfig.mockResolvedValue(makeConfig(['victim']));
      const result = await handleAdminUserAction({
        body: { action, inactiveDays: 90, usernames: ['victim'] },
        operatorUsername: 'boss',
        operatorRole: 'owner',
      });
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: '页面已更新，请刷新后重试' });
      expect(db.deleteUser).not.toHaveBeenCalled();
      expect(db.getAllUserLastActive).not.toHaveBeenCalled();
    },
  );

  it('读配置前先失效缓存，避免基于过期配置写入', async () => {
    mockGetConfig.mockResolvedValue(makeConfig(['victim']));

    await handleAdminUserAction({
      body: { action: 'deleteUser', targetUsername: 'victim' },
      operatorUsername: 'boss',
      operatorRole: 'owner',
    });

    expect(callOrder).toEqual(['invalidateConfigCache', 'getConfig']);
  });

  it('刚注册的用户能被立即操作', async () => {
    mockGetConfig.mockResolvedValue(makeConfig(['just-registered']));

    const result = await handleAdminUserAction({
      body: { action: 'deleteUser', targetUsername: 'just-registered' },
      operatorUsername: 'boss',
      operatorRole: 'owner',
    });

    expect(result.status).toBeUndefined();
    expect(db.deleteUser).toHaveBeenCalledWith('just-registered', {
      operatorUsername: 'boss',
      operatorRole: 'owner',
      excludeSelf: true,
    });
  });
});

describe('邀请码后台数据库写入', () => {
  beforeEach(() => {
    mockGetConfig.mockResolvedValue(makeConfig([]));
    (db.createInviteCode as jest.Mock).mockResolvedValue('created');
    (db.deleteInviteCode as jest.Mock).mockResolvedValue(true);
  });

  it('创建时归一化并直接写表，不保存配置', async () => {
    const result = await handleAdminUserAction({
      operatorUsername: 'manager',
      operatorRole: 'admin',
      body: {
        action: 'createInviteCode',
        code: ' welcome ',
        validDays: 7,
        maxUses: 2,
      },
    });
    expect(result.body).toEqual({ ok: true, code: 'WELCOME' });
    expect(db.createInviteCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'WELCOME',
        maxUses: 2,
        createdBy: 'manager',
      }),
    );
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it.each([
    ['exists', 409],
    ['limit', 400],
  ] as const)('处理数据库创建结果 %s', async (outcome, status) => {
    (db.createInviteCode as jest.Mock).mockResolvedValue(outcome);
    const result = await handleAdminUserAction({
      operatorUsername: 'manager',
      operatorRole: 'admin',
      body: { action: 'createInviteCode', code: 'WELCOME', validDays: 7 },
    });
    expect(result.status).toBe(status);
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('删除直接写表，未命中返回 404', async () => {
    const context = {
      operatorUsername: 'manager',
      operatorRole: 'admin' as const,
      body: { action: 'deleteInviteCode', code: ' welcome ' },
    };
    expect((await handleAdminUserAction(context)).body).toEqual({ ok: true });
    expect(db.deleteInviteCode).toHaveBeenCalledWith('WELCOME');
    (db.deleteInviteCode as jest.Mock).mockResolvedValue(false);
    expect((await handleAdminUserAction(context)).status).toBe(404);
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });
});
