import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import type { OAuthIdentity } from '@/lib/oauth-identity';
import type { IStorage } from '@/lib/types';

installCryptoPolyfill();
export function oauthIdentityContract(
  createStorage: () => IStorage,
  reset: (storage: IStorage) => Promise<void> = async () => {},
) {
  let storage: IStorage;
  const identity = (username: string, id = '100'): OAuthIdentity => ({
    provider: 'linuxdo',
    providerUserId: id,
    username,
    providerUsername: 'LinuxUser',
    autoCreated: false,
    createdAt: 1234,
  });
  beforeEach(async () => {
    storage = createStorage();
    await reset(storage);
  });
  afterEach(async () => {
    await reset(storage);
  });
  it('规范用户名、身份唯一性及解绑更新契约', async () => {
    await storage.registerUser('alice', 'password');
    await storage.registerUser('bobby', 'password');
    expect(await storage.bindOAuthIdentity(identity('ALICE'))).toBe('bound');
    expect(await storage.bindOAuthIdentity(identity('bobby'))).toBe(
      'identity_taken',
    );
    expect(await storage.bindOAuthIdentity(identity('alice', '101'))).toBe(
      'user_bound',
    );
    expect(await storage.bindOAuthIdentity(identity('ALICE'))).toBe('bound');
    expect(await storage.bindOAuthIdentity(identity('missing', '102'))).toBe(
      'user_missing',
    );
    await storage.updateOAuthProviderUsername('100', 'Renamed');
    expect(await storage.getUserOAuthIdentity('ALICE')).toEqual({
      ...identity('alice'),
      providerUsername: 'Renamed',
    });
    expect(await storage.isPasswordSet('ALICE')).toBe(true);
    expect(await storage.unbindOAuthIdentity('ALICE')).toBe(true);
    expect(await storage.getOAuthIdentity('100')).toBeNull();
  });
  it('建号身份冲突整笔回滚，自动建号拒绝解绑', async () => {
    await storage.registerUser(
      'alice',
      'password',
      undefined,
      undefined,
      identity('alice'),
    );
    expect((await storage.getUserOAuthIdentity('alice'))?.autoCreated).toBe(
      true,
    );
    expect(await storage.unbindOAuthIdentity('alice')).toBe(false);
    await expect(
      storage.registerUser(
        'bobby',
        'password',
        undefined,
        undefined,
        identity('bobby'),
      ),
    ).rejects.toThrow();
    expect(await storage.checkUserExist('bobby')).toBe(false);
    expect(await storage.getUserAccess('bobby')).toBeNull();
    expect(await storage.getUserOAuthIdentity('bobby')).toBeNull();
    expect(await storage.checkUserExist('alice')).toBe(true);
  });
  it('LinuxDo 首次设密后可用本站用户名登录，再次修改必须校验旧密码', async () => {
    await storage.registerUser(
      ' Linux_User ',
      'random-secret',
      undefined,
      undefined,
      identity('linux_user'),
    );
    expect(await storage.isPasswordSet('LINUX_USER')).toBe(false);
    expect(
      await storage.changePassword('LINUX_USER', 'first-password', false, null),
    ).toBe(true);
    expect(await storage.isPasswordSet('linux_user')).toBe(true);
    expect(await storage.verifyUser(' Linux_User ', 'first-password')).toBe(
      true,
    );
    expect(await storage.verifyUser('linux_user', 'random-secret')).toBe(false);
    expect(
      await storage.changePassword(
        'linux_user',
        'second-password',
        false,
        null,
      ),
    ).toBe(false);
    expect(
      await storage.changePassword(
        'linux_user',
        'second-password',
        false,
        'wrong-password',
      ),
    ).toBe(false);
    expect(
      await storage.changePassword(
        'linux_user',
        'second-password',
        false,
        'first-password',
      ),
    ).toBe(true);
    expect(await storage.verifyUser('LINUX_USER', 'second-password')).toBe(
      true,
    );
    expect(await storage.unbindOAuthIdentity('linux_user')).toBe(false);
  });
  it('普通账号及绑定已有账号不能免旧密码，管理员重置后不能再次首次设密', async () => {
    await storage.registerUser('alice', 'original-password');
    await storage.bindOAuthIdentity(identity('alice'));
    expect(await storage.isPasswordSet('alice')).toBe(true);
    expect(
      await storage.changePassword('alice', 'new-password', false, null),
    ).toBe(false);
    await storage.registerUser(
      'bobby',
      'random-secret',
      undefined,
      undefined,
      identity('bobby', '101'),
    );
    await storage.changePassword('bobby', 'admin-password', true);
    expect(await storage.isPasswordSet('bobby')).toBe(true);
    expect(
      await storage.changePassword('bobby', 'new-password', false, null),
    ).toBe(false);
    expect(await storage.verifyUser('bobby', 'admin-password')).toBe(true);
  });
  it('用户删除与不活跃清理覆盖身份表', async () => {
    await storage.registerUser(
      'alice',
      'password',
      undefined,
      undefined,
      identity('alice'),
    );
    await storage.registerUser(
      'bobby',
      'password',
      undefined,
      undefined,
      identity('bobby', '101'),
    );
    await storage.deleteUser('alice');
    expect(await storage.getOAuthIdentity('100')).toBeNull();
    await storage.recordUserLogin('bobby', 1);
    expect(
      await storage.deleteUserIfInactive('bobby', Date.now() + 1, 'operator'),
    ).toBe(true);
    expect(await storage.getOAuthIdentity('101')).toBeNull();
  });
}
