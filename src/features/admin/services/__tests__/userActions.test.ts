/** @jest-environment node */

import { randomBytes } from 'crypto';

import {
  type InviteCode,
  MAX_INVITE_CODES,
} from '@/features/admin/services/inviteCodes';
import type { AdminConfig } from '@/types/admin';

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn(),
}));

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
    createInviteCodes: jest.fn(),
    deleteInviteCode: jest.fn(),
    purgeInviteCodes: jest.fn(),
    getAdminUserPage: jest.fn(),
  },
}));

import { handleAdminUserAction } from '@/features/admin/services/userActions';
import { ConfigConflictError } from '@/lib/config';
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
          selection: {
            mode: 'all',
            filter: {
              q: ' a ',
              role: 'user',
              login: 'none',
              ungrouped: true,
            },
            excluded: ['BOB'],
          },
          userGroups: ['VIP'],
          dryRun: true,
        },
      });
      expect(result.body).toEqual({ affectedCount, skippedCount });
      expect(db.getAdminUserPage).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'a',
          role: 'user',
          login: 'none',
          ungrouped: true,
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
    let sequence = 0;
    (randomBytes as jest.Mock)
      .mockReset()
      .mockImplementation((size: number) => {
        const bytes = Buffer.alloc(size);
        bytes[0] = sequence % 32;
        bytes[1] = Math.floor(sequence++ / 32);
        return bytes;
      });
    (db.createInviteCodes as jest.Mock)
      .mockReset()
      .mockImplementation(async (items: InviteCode[]) => ({
        codes: items.map((item) => item.code),
      }));
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
    expect(result.body).toEqual({
      ok: true,
      code: 'WELCOME',
      codes: ['WELCOME'],
    });
    expect(result.headers).toEqual({ 'Cache-Control': 'no-store' });
    expect(db.createInviteCodes).toHaveBeenCalledWith([
      expect.objectContaining({
        code: 'WELCOME',
        maxUses: 2,
        createdBy: 'manager',
      }),
    ]);
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it.each([
    0,
    -1,
    1.5,
    MAX_INVITE_CODES + 1,
    '2',
    null,
    false,
    NaN,
    Infinity,
    {},
    [],
  ])('拒绝无效生成数量 %p', async (count) => {
    const result = await handleAdminUserAction({
      operatorUsername: 'manager',
      operatorRole: 'admin',
      body: { action: 'createInviteCode', validDays: 7, count },
    });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: `生成数量需在 1-${MAX_INVITE_CODES} 之间`,
    });
    expect(db.createInviteCodes).not.toHaveBeenCalled();
  });

  it('拒绝批量生成自定义邀请码', async () => {
    const result = await handleAdminUserAction({
      operatorUsername: 'manager',
      operatorRole: 'admin',
      body: {
        action: 'createInviteCode',
        validDays: 7,
        count: 2,
        code: ' welcome ',
      },
    });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: '自定义邀请码只能单个生成' });
    expect(db.createInviteCodes).not.toHaveBeenCalled();
  });

  it.each([undefined, 1, 3, MAX_INVITE_CODES])(
    '生成数量 %p 的完整批次并返回兼容字段',
    async (count) => {
      const result = await handleAdminUserAction({
        operatorUsername: 'manager',
        operatorRole: 'admin',
        body: { action: 'createInviteCode', validDays: 7, count, maxUses: 2 },
      });
      expect(db.createInviteCodes).toHaveBeenCalledTimes(1);
      const items = (db.createInviteCodes as jest.Mock).mock
        .calls[0][0] as InviteCode[];
      const codes = items.map((item) => item.code);
      expect(codes).toHaveLength(count ?? 1);
      expect(new Set(codes).size).toBe(codes.length);
      for (const item of items) {
        expect(item).toMatchObject({
          createdBy: 'manager',
          maxUses: 2,
          usedCount: 0,
        });
        expect(item.expiresAt - item.createdAt).toBe(7 * 86400000);
      }
      expect(result.body).toEqual({ ok: true, code: codes[0], codes });
      expect(result.headers).toEqual({ 'Cache-Control': 'no-store' });
      expect(mockSaveConfig).not.toHaveBeenCalled();
    },
  );

  it('随机码冲突后重新生成整批', async () => {
    (db.createInviteCodes as jest.Mock).mockResolvedValueOnce('exists');
    const result = await handleAdminUserAction({
      operatorUsername: 'manager',
      operatorRole: 'admin',
      body: { action: 'createInviteCode', validDays: 7, count: 3 },
    });
    const calls = (db.createInviteCodes as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    const first = calls[0][0] as InviteCode[];
    const second = calls[1][0] as InviteCode[];
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    const codes = second.map((item) => item.code);
    expect(
      codes.every((code) => !first.some((item) => item.code === code)),
    ).toBe(true);
    expect(result.body).toEqual({ ok: true, code: codes[0], codes });
  });

  it('批内随机码重复时丢弃整批并重新生成', async () => {
    (randomBytes as jest.Mock)
      .mockReturnValueOnce(Buffer.alloc(12, 31))
      .mockReturnValueOnce(Buffer.alloc(12, 31));
    const result = await handleAdminUserAction({
      operatorUsername: 'manager',
      operatorRole: 'admin',
      body: { action: 'createInviteCode', validDays: 7, count: 2 },
    });
    expect(randomBytes).toHaveBeenCalledTimes(4);
    expect(db.createInviteCodes).toHaveBeenCalledTimes(1);
    expect(result.body).toMatchObject({ ok: true });
  });

  it.each(['existing', 'within-batch'])(
    '随机码持续冲突 %s 时最多尝试十批',
    async (conflict) => {
      if (conflict === 'existing')
        (db.createInviteCodes as jest.Mock).mockResolvedValue('exists');
      else (randomBytes as jest.Mock).mockReturnValue(Buffer.alloc(12));
      const result = await handleAdminUserAction({
        operatorUsername: 'manager',
        operatorRole: 'admin',
        body: { action: 'createInviteCode', validDays: 7, count: 2 },
      });
      expect(result.status).toBe(500);
      expect(result.body).toEqual({ error: '生成邀请码失败，请重试' });
      expect(randomBytes).toHaveBeenCalledTimes(20);
      expect(db.createInviteCodes).toHaveBeenCalledTimes(
        conflict === 'existing' ? 10 : 0,
      );
    },
  );

  it('只返回存储事务按剩余容量实际创建的码', async () => {
    (db.createInviteCodes as jest.Mock).mockImplementationOnce(
      async (items: InviteCode[]) => ({
        codes: items.slice(0, 5).map((item) => item.code),
      }),
    );
    const result = await handleAdminUserAction({
      operatorUsername: 'manager',
      operatorRole: 'admin',
      body: { action: 'createInviteCode', validDays: 7, count: 200 },
    });
    const items = (db.createInviteCodes as jest.Mock).mock
      .calls[0][0] as InviteCode[];
    const codes = items.slice(0, 5).map((item) => item.code);
    expect(items).toHaveLength(200);
    expect(result.body).toEqual({ ok: true, code: codes[0], codes });
    expect(db.createInviteCodes).toHaveBeenCalledTimes(1);
  });

  it('剩余容量为零时直接返回容量错误', async () => {
    (db.createInviteCodes as jest.Mock).mockResolvedValue('limit');
    const result = await handleAdminUserAction({
      operatorUsername: 'manager',
      operatorRole: 'admin',
      body: { action: 'createInviteCode', validDays: 7, count: 3 },
    });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: `有效邀请码不能超过 ${MAX_INVITE_CODES} 个`,
    });
    expect(db.createInviteCodes).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['exists', 409],
    ['limit', 400],
  ] as const)('处理数据库创建结果 %s', async (outcome, status) => {
    (db.createInviteCodes as jest.Mock).mockResolvedValue(outcome);
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

  it('清理失效邀请码删除所有已过期和已用尽的码并返回条数', async () => {
    (db.purgeInviteCodes as jest.Mock).mockResolvedValue(3);
    const before = Date.now();
    const result = await handleAdminUserAction({
      operatorUsername: 'manager',
      operatorRole: 'admin',
      body: { action: 'purgeInactiveInviteCodes' },
    });
    expect(result.body).toEqual({ ok: true, deleted: 3 });
    const [options] = (db.purgeInviteCodes as jest.Mock).mock.calls[0];
    expect(options.includeExhausted).toBe(true);
    expect(options.expiredBefore).toBeGreaterThanOrEqual(before);
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });
});

describe('LinuxDo 后台注册设置', () => {
  beforeEach(() => {
    mockGetConfig.mockResolvedValue(makeConfig([]));
  });
  it('按配置身份写入并在冲突重试前重新失效缓存', async () => {
    const config = makeConfig([]);
    mockGetConfig.mockResolvedValue(config);
    config.UserConfig.LinuxDo = {
      Enabled: false,
      MinTrustLevel: 1,
      ClientId: 'client',
      ClientSecret: 'secret',
      RedirectUri: '',
    };
    mockSaveConfig.mockRejectedValueOnce(new ConfigConflictError());
    const result = await handleAdminUserAction({
      operatorUsername: 'owner',
      operatorRole: 'owner',
      body: {
        action: 'setLinuxDo',
        linuxDo: { Enabled: true, MinTrustLevel: 3 },
      },
    });
    expect(result.body).toEqual({ ok: true });
    expect(config.UserConfig.LinuxDo).toEqual({
      Enabled: true,
      MinTrustLevel: 3,
      ClientId: 'client',
      ClientSecret: 'secret',
      RedirectUri: '',
    });
    expect(mockSaveConfig).toHaveBeenLastCalledWith(config);
    expect(callOrder).toEqual([
      'invalidateConfigCache',
      'getConfig',
      'invalidateConfigCache',
      'getConfig',
    ]);
  });
  it.each([
    null,
    { Enabled: 'true', MinTrustLevel: 1 },
    { Enabled: true, MinTrustLevel: 5 },
    { Enabled: true, MinTrustLevel: 1.5 },
  ])('拒绝无效设置 %o', async (linuxDo) => {
    const result = await handleAdminUserAction({
      operatorUsername: 'owner',
      operatorRole: 'owner',
      body: { action: 'setLinuxDo', linuxDo },
    });
    expect(result.status).toBe(400);
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });
  it('缺凭证时允许关闭而拒绝开启', async () => {
    const act = (Enabled: boolean) =>
      handleAdminUserAction({
        operatorUsername: 'owner',
        operatorRole: 'owner',
        body: { action: 'setLinuxDo', linuxDo: { Enabled, MinTrustLevel: 1 } },
      });
    expect((await act(true)).status).toBe(400);
    expect((await act(false)).body).toEqual({ ok: true });
  });
});

describe('后台凭证与注册通道写入', () => {
  let config: AdminConfig;
  const act = (body: unknown) =>
    handleAdminUserAction({
      operatorUsername: 'manager',
      operatorRole: 'admin',
      body,
    });
  const credentials = {
    action: 'setLinuxDoCredentials',
    clientId: ' client ',
    clientSecret: ' secret ',
    redirectUri: '',
  };
  beforeEach(() => {
    config = makeConfig([]);
    mockGetConfig.mockResolvedValue(config);
  });
  it('管理员保存规范化凭证，空密钥保留已有值，开关保留凭证', async () => {
    expect(
      await act({
        ...credentials,
        redirectUri: ' HTTPS://EXAMPLE.COM:443/api/auth/linuxdo/callback ',
      }),
    ).toMatchObject({
      body: { ok: true },
      headers: { 'Cache-Control': 'no-store' },
    });
    expect(config.UserConfig.LinuxDo).toEqual({
      Enabled: false,
      MinTrustLevel: 1,
      ClientId: 'client',
      ClientSecret: 'secret',
      RedirectUri: 'https://example.com/api/auth/linuxdo/callback',
    });
    expect(
      (await act({ ...credentials, clientId: 'updated', clientSecret: ' ' }))
        .body,
    ).toEqual({ ok: true });
    expect(config.UserConfig.LinuxDo).toMatchObject({
      ClientId: 'updated',
      ClientSecret: 'secret',
      RedirectUri: '',
    });
    await act({
      action: 'setLinuxDo',
      linuxDo: { Enabled: true, MinTrustLevel: 2, ClientSecret: 'injected' },
    });
    expect(config.UserConfig.LinuxDo).toMatchObject({
      Enabled: true,
      MinTrustLevel: 2,
      ClientSecret: 'secret',
    });
    expect(mockSaveConfig.mock.calls.every(([saved]) => saved === config)).toBe(
      true,
    );
  });
  it.each([
    { clientId: '' },
    { clientId: 'a b' },
    { clientId: 'a\u0000b' },
    { clientId: 'a'.repeat(257) },
    { clientId: null },
    { clientSecret: 'a'.repeat(513) },
    { clientSecret: 'a\nb' },
    { clientSecret: 'a\u007fb' },
    { clientSecret: null },
    { redirectUri: 'ftp://example.com/api/auth/linuxdo/callback' },
    { redirectUri: '/api/auth/linuxdo/callback' },
    { redirectUri: 'https://u:p@example.com/api/auth/linuxdo/callback' },
    { redirectUri: 'https://example.com/api/auth/linuxdo/callback#hash' },
    { redirectUri: 'https://example.com/other' },
    { redirectUri: null },
  ])('拒绝无效凭证字段 %o', async (patch) => {
    expect((await act({ ...credentials, ...patch })).status).toBe(400);
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });
  it('首次保存要求密钥且启用要求两项凭证', async () => {
    expect((await act({ ...credentials, clientSecret: '' })).body).toEqual({
      error: '请填写 Client Secret',
    });
    expect(
      (
        await act({
          action: 'setLinuxDo',
          linuxDo: { Enabled: true, MinTrustLevel: 1 },
        })
      ).body,
    ).toEqual({ error: '请先保存 LinuxDo Client ID 与 Client Secret' });
  });
  it.each([
    null,
    {},
    { Password: true, LinuxDo: 'true' },
    { Password: false, LinuxDo: false },
  ])('拒绝无效注册通道 %o', async (channels) => {
    const result = await act({ action: 'setRegisterChannels', channels });
    expect(result.status).toBe(400);
    if (channels?.Password === false)
      expect(result.body).toEqual({ error: '至少保留一个注册通道' });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });
  it.each([
    { Password: true, LinuxDo: false },
    { Password: false, LinuxDo: true },
    { Password: true, LinuxDo: true },
  ])('保存注册通道 %o', async (channels) => {
    expect(
      (await act({ action: 'setRegisterChannels', channels })).body,
    ).toEqual({ ok: true });
    expect(config.UserConfig.RegisterChannels).toEqual(channels);
    expect(callOrder).toEqual(['invalidateConfigCache', 'getConfig']);
  });
  it.each(['setLinuxDoCredentials', 'setRegisterChannels'])(
    '新动作冲突重试重新读取配置：%s',
    async (action) => {
      const latest = makeConfig([]);
      latest.UserConfig.LinuxDo = {
        Enabled: true,
        MinTrustLevel: 2,
        ClientId: 'old',
        ClientSecret: 'latest-secret',
        RedirectUri: '',
      };
      config.UserConfig.LinuxDo = {
        ...latest.UserConfig.LinuxDo,
        ClientSecret: 'old-secret',
      };
      mockGetConfig.mockResolvedValueOnce(config).mockResolvedValueOnce(latest);
      mockSaveConfig.mockRejectedValueOnce(new ConfigConflictError());
      expect(
        (
          await act({
            ...credentials,
            action,
            clientSecret: '',
            channels: { Password: false, LinuxDo: true },
          })
        ).body,
      ).toEqual({ ok: true });
      expect(mockSaveConfig).toHaveBeenLastCalledWith(latest);
      expect(latest.UserConfig.LinuxDo?.ClientSecret).toBe('latest-secret');
      expect(callOrder).toEqual([
        'invalidateConfigCache',
        'getConfig',
        'invalidateConfigCache',
        'getConfig',
      ]);
    },
  );
});
