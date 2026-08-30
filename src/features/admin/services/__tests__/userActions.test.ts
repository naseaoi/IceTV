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
    deleteUser: jest.fn(),
    getAllUserLastActive: jest.fn(),
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
  (db.deleteUser as jest.Mock).mockResolvedValue(undefined);
  (db.getAllUserLastActive as jest.Mock).mockResolvedValue({});
});

describe('handleAdminUserAction 配置读取时机', () => {
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
    expect(db.deleteUser).toHaveBeenCalledWith('just-registered');
  });
});
