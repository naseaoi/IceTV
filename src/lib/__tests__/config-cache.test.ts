/** @jest-environment node */

import { AdminConfig } from '@/types/admin';
import { DEFAULT_RUNTIME_PARAMS } from '@/lib/runtime-params';

const baseConfig: AdminConfig = {
  ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
  ConfigFile: '',
  SiteConfig: {
    SiteName: 'IceTV',
    SiteIcon: '',
    Announcement: '',
    EnableLiveEntry: false,
    DefaultAggregateSearch: true,
    EnableOptimization: true,
    AutoSwitchSourceOnTimeout: false,
    LiveDirectConnect: false,
    ...DEFAULT_RUNTIME_PARAMS,
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
  const originalConfigCacheTtl = process.env.CONFIG_CACHE_TTL_MS;

  afterEach(() => {
    if (originalConfigCacheTtl === undefined) {
      delete process.env.CONFIG_CACHE_TTL_MS;
    } else {
      process.env.CONFIG_CACHE_TTL_MS = originalConfigCacheTtl;
    }
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

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

  it('reuses read config until ttl expires', async () => {
    process.env.CONFIG_CACHE_TTL_MS = '10';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const nextConfig = cloneBaseConfig();
    nextConfig.SiteConfig.SiteName = 'Next';
    const getAdminConfig = jest
      .fn()
      .mockResolvedValueOnce(cloneBaseConfig())
      .mockResolvedValueOnce(nextConfig);
    const { getConfigForRead } = await loadConfigModule(jest.fn(), {
      getAdminConfig,
    });

    const first = await getConfigForRead();
    const second = await getConfigForRead();
    expect(second).toBe(first);
    expect(getAdminConfig).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(11);
    const third = await getConfigForRead();
    expect(third.SiteConfig.SiteName).toBe('Next');
    expect(getAdminConfig).toHaveBeenCalledTimes(2);
  });

  it('returns detached api site entries from read cache', async () => {
    const adminConfig = cloneBaseConfig();
    adminConfig.SourceConfig = [
      {
        key: 'source-1',
        name: 'Source 1',
        api: 'https://example.com/api.php',
        disabled: false,
        from: 'custom',
      },
    ];
    const { getAvailableApiSites } = await loadConfigModule(jest.fn(), {
      adminConfig,
    });

    const first = await getAvailableApiSites();
    first[0].name = 'Mutated';
    const second = await getAvailableApiSites();

    expect(second[0].name).toBe('Source 1');
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

  it('serves cached config when a later read fails', async () => {
    process.env.CONFIG_CACHE_TTL_MS = '0';
    const realConfig = cloneBaseConfig();
    realConfig.SiteConfig.SiteName = 'Real-Site';
    const getAdminConfig = jest
      .fn()
      .mockResolvedValueOnce(realConfig)
      .mockRejectedValueOnce(new Error('read failed'));
    const { getConfig } = await loadConfigModule(jest.fn(), {
      getAdminConfig,
    });

    const first = await getConfig();
    expect(first.SiteConfig.SiteName).toBe('Real-Site');

    const second = await getConfig();
    expect(second.SiteConfig.SiteName).toBe('Real-Site');
    expect(getAdminConfig).toHaveBeenCalledTimes(2);
  });

  it('throws instead of persisting defaults when the first read fails', async () => {
    const saveAdminConfig = jest.fn();
    const getAdminConfig = jest
      .fn()
      .mockRejectedValue(new Error('read failed'));
    const { getConfig } = await loadConfigModule(saveAdminConfig, {
      getAdminConfig,
    });

    await expect(getConfig()).rejects.toThrow('read failed');
    expect(saveAdminConfig).not.toHaveBeenCalled();
  });

  it('defaults missing fluid search config to enabled', async () => {
    const { configSelfCheck } = await loadConfigModule(jest.fn());
    const config = cloneBaseConfig();
    delete (config.SiteConfig as Partial<typeof config.SiteConfig>).FluidSearch;

    expect(configSelfCheck(config).SiteConfig.FluidSearch).toBe(true);
  });

  it('exposes public-safe proxy defaults in public config', async () => {
    const adminConfig = cloneBaseConfig();
    adminConfig.SiteConfig.DoubanProxyType = 'server';
    adminConfig.SiteConfig.DoubanImageProxyType = 'img3';
    adminConfig.SiteConfig.BangumiDataSource = 'direct';
    const { getPublicConfig } = await loadConfigModule(jest.fn(), {
      adminConfig,
    });

    await expect(getPublicConfig()).resolves.toMatchObject({
      DoubanProxyType: 'direct',
      DoubanImageProxyType: 'img3',
      BangumiDataSource: 'direct',
    });
  });

  it('falls back custom proxy defaults in public config', async () => {
    const adminConfig = cloneBaseConfig();
    adminConfig.SiteConfig.DoubanProxyType = 'custom';
    adminConfig.SiteConfig.DoubanImageProxyType = 'custom';
    adminConfig.SiteConfig.BangumiDataSource = 'custom';
    const { getPublicConfig } = await loadConfigModule(jest.fn(), {
      adminConfig,
    });

    await expect(getPublicConfig()).resolves.toMatchObject({
      DoubanProxyType: 'direct',
      DoubanImageProxyType: 'direct',
      BangumiDataSource: 'direct',
    });
  });

  it('clears custom proxy values from stored site config', async () => {
    const { configSelfCheck } = await loadConfigModule(jest.fn());
    const config = cloneBaseConfig();
    config.SiteConfig.DoubanProxyType = 'custom';
    config.SiteConfig.DoubanProxy = 'https://data.example/fetch?url=';
    config.SiteConfig.DoubanImageProxyType = 'custom';
    config.SiteConfig.DoubanImageProxy = 'https://image.example/fetch?url=';
    config.SiteConfig.BangumiDataSource = 'custom';
    config.SiteConfig.BangumiProxy = 'https://bangumi.example/fetch?url=';

    const checked = configSelfCheck(config);

    expect(checked.SiteConfig).toMatchObject({
      DoubanProxyType: 'direct',
      DoubanProxy: '',
      DoubanImageProxyType: 'direct',
      DoubanImageProxy: '',
      BangumiDataSource: 'direct',
      BangumiProxy: '',
    });
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
