/** @jest-environment node */

import { AdminConfig } from '@/types/admin';

const baseConfig: AdminConfig = {
  ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
  ConfigFile: '',
  SiteConfig: {
    SiteName: 'IceTV',
    SiteIcon: '',
    Announcement: '',
    EnableLiveEntry: false,
    SearchDownstreamMaxPage: 5,
    SiteInterfaceCacheTime: 300,
    DoubanProxyType: 'direct',
    DoubanProxy: '',
    BangumiDataSource: 'server',
    BangumiProxy: '',
    DoubanImageProxyType: 'direct',
    DoubanImageProxy: '',
    DisableYellowFilter: false,
    FluidSearch: true,
  },
  UserConfig: {
    Users: [{ username: 'owner-1', role: 'owner', banned: false }],
    OpenRegister: false,
    Tags: [],
  },
  SourceConfig: [],
  CustomCategories: [],
  LiveConfig: [],
};

type LoadConfigOptions = {
  adminConfig?: AdminConfig;
  getAdminConfig?: jest.Mock;
  userNames?: string[];
};

async function loadConfigModule(
  saveAdminConfig: jest.Mock,
  options: LoadConfigOptions = {},
) {
  jest.resetModules();
  const adminConfig = options.adminConfig || cloneBaseConfig();
  const getAdminConfig =
    options.getAdminConfig || jest.fn().mockResolvedValue(adminConfig);
  const userNames = options.userNames || [];

  jest.doMock('@/lib/db', () => ({
    db: {
      getAdminConfig,
      getAllUsers: jest.fn().mockResolvedValue(userNames),
      saveAdminConfig,
    },
  }));
  jest.doMock('@/lib/env.server', () => ({
    getOwnerUsername: () => 'owner-1',
  }));
  return require('../config') as typeof import('../config.js');
}

function cloneBaseConfig(): AdminConfig {
  return JSON.parse(JSON.stringify(baseConfig)) as AdminConfig;
}

describe('config cache persistence', () => {
  it('returns cloned config objects', async () => {
    const { getConfig } = await loadConfigModule(jest.fn());
    const first = await getConfig();

    first.SiteConfig.SiteName = 'Mutated';

    const second = await getConfig();
    expect(second.SiteConfig.SiteName).toBe('IceTV');
  });

  it('keeps cached config unchanged when save fails', async () => {
    const saveAdminConfig = jest
      .fn()
      .mockRejectedValue(new Error('write failed'));
    const { getConfig, saveConfig } = await loadConfigModule(saveAdminConfig);
    const current = await getConfig();

    await expect(
      saveConfig({
        ...current,
        SiteConfig: { ...current.SiteConfig, SiteName: 'Next' },
      }),
    ).rejects.toThrow('write failed');

    const after = await getConfig();
    expect(after.SiteConfig.SiteName).toBe('IceTV');
  });

  it('uses database users as the source of truth', async () => {
    const adminConfig = cloneBaseConfig();
    adminConfig.UserConfig.Users = [
      { username: 'owner-1', role: 'owner', banned: false },
      {
        username: 'db-user',
        role: 'admin',
        banned: true,
        tags: ['vip'],
      },
      { username: 'stale-user', role: 'user', banned: false },
    ];

    const { getConfig } = await loadConfigModule(jest.fn(), {
      adminConfig,
      userNames: ['db-user', 'new-user'],
    });

    const config = await getConfig();

    expect(config.UserConfig.Users).toEqual([
      {
        username: 'owner-1',
        role: 'owner',
        banned: false,
        enabledApis: undefined,
        tags: undefined,
      },
      {
        username: 'db-user',
        role: 'admin',
        banned: true,
        enabledApis: undefined,
        tags: ['vip'],
      },
      {
        username: 'new-user',
        role: 'user',
        banned: false,
        enabledApis: undefined,
        tags: undefined,
      },
    ]);
  });

  it('rejects stale config writes', async () => {
    const saveAdminConfig = jest.fn();
    const changedConfig = cloneBaseConfig();
    changedConfig.SiteConfig.SiteName = 'Changed elsewhere';
    const getAdminConfig = jest
      .fn()
      .mockResolvedValueOnce(cloneBaseConfig())
      .mockResolvedValueOnce(changedConfig);
    const { ConfigConflictError, getConfig, saveConfig } =
      await loadConfigModule(saveAdminConfig, { getAdminConfig });

    const config = await getConfig();
    config.SiteConfig.Announcement = 'local change';

    await expect(saveConfig(config)).rejects.toThrow(ConfigConflictError);
    expect(saveAdminConfig).not.toHaveBeenCalled();
  });

  it('defaults missing fluid search config to enabled', async () => {
    const { configSelfCheck } = await loadConfigModule(jest.fn());
    const config = cloneBaseConfig();
    delete (config.SiteConfig as Partial<typeof config.SiteConfig>).FluidSearch;

    expect(configSelfCheck(config).SiteConfig.FluidSearch).toBe(true);
  });

  it('keeps disabled fluid search config disabled', async () => {
    const { configSelfCheck } = await loadConfigModule(jest.fn());
    const config = cloneBaseConfig();
    config.SiteConfig.FluidSearch = false;

    expect(configSelfCheck(config).SiteConfig.FluidSearch).toBe(false);
  });

  it('drops invalid live source entries during config self check', async () => {
    const { configSelfCheck } = await loadConfigModule(jest.fn());
    const config = cloneBaseConfig();
    config.LiveConfig = [
      {
        key: ' valid ',
        name: ' Live ',
        url: ' https://example.com/live.m3u ',
        ua: ' ',
        epg: null,
        from: 'custom',
      },
      {
        key: null,
        name: 'Broken',
        url: 'https://example.com/broken.m3u',
        from: 'custom',
      },
    ] as unknown as AdminConfig['LiveConfig'];

    expect(configSelfCheck(config).LiveConfig).toEqual([
      {
        key: 'valid',
        name: 'Live',
        url: 'https://example.com/live.m3u',
        ua: undefined,
        epg: undefined,
        from: 'custom',
      },
    ]);
  });
});
