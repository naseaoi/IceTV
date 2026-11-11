/** @jest-environment node */

import { DEFAULT_RUNTIME_PARAMS } from '@/lib/runtime-params';
import { AdminConfig } from '@/types/admin';

const baseConfig: AdminConfig = {
  ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
  ConfigFile: '',
  SiteConfig: {
    SiteName: 'IceTV',
    SiteIcon: '',
    Announcement: '',
    FooterText: '',
    EnableLiveEntry: false,
    LiveAccess: 'all',
    DefaultAggregateSearch: true,
    EnableOptimization: true,
    AutoSwitchSource: false,
    UpstreamProxyPoolSegments: false,
    EnableDanmaku: false,
    EnableUserDanmaku: false,
    ...DEFAULT_RUNTIME_PARAMS,
    SourceCoverProxyMode: 'auto',
    SearchDownstreamMaxPage: 5,
    SiteInterfaceCacheTime: 300,
    DoubanProxyType: 'direct',
    DoubanImageProxyType: 'direct',
    DisableYellowFilter: false,
    FluidSearch: true,
  },
  UserConfig: {
    Users: [{ username: 'owner-1', role: 'owner', banned: false }],
    OpenRegister: false,
    RequireInviteCode: false,
    InviteCodes: [],
    Tags: [],
  },
  SourceConfig: [],
  CustomCategories: [],
  LiveConfig: [],
};

type LoadConfigOptions = {
  adminConfig?: AdminConfig;
  getAdminConfig?: jest.Mock;
  compareAndSetAdminConfig?: jest.Mock;
  userNames?: string[];
  userAccess?: Record<string, { role: 'user' | 'admin' }>;
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
      getConfigSubscription: jest.fn().mockResolvedValue({
        ConfigFile: '',
        ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
      }),
      getAllUsers: jest.fn().mockResolvedValue(userNames),
      getUserAccess: jest.fn(async (username: string) =>
        options.userAccess?.[username]
          ? { username, ...options.userAccess[username] }
          : null,
      ),
      saveAdminConfig,
      compareAndSetAdminConfig:
        options.compareAndSetAdminConfig ||
        (async (_expected: unknown, next: AdminConfig) => {
          await saveAdminConfig(next);
          return true;
        }),
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

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

  it('preserves user danmaku through self-check and public config', async () => {
    const config = cloneBaseConfig();
    config.SiteConfig.EnableUserDanmaku = true;
    const { configSelfCheck, getPublicConfig } = await loadConfigModule(
      jest.fn(),
      { adminConfig: config },
    );
    expect(configSelfCheck(config).SiteConfig.EnableUserDanmaku).toBe(true);
    expect((await getPublicConfig()).EnableUserDanmaku).toBe(true);
    const legacy = cloneBaseConfig();
    delete (legacy.SiteConfig as Partial<AdminConfig['SiteConfig']>)
      .EnableUserDanmaku;
    expect(configSelfCheck(legacy).SiteConfig.EnableUserDanmaku).toBe(false);
  });

  it('drops a default user group that no longer exists', async () => {
    const { configSelfCheck } = await loadConfigModule(jest.fn(), {
      adminConfig: cloneBaseConfig(),
    });
    const config = cloneBaseConfig();
    config.UserConfig.Tags = [{ name: 'vip', enabledApis: [] }];
    config.UserConfig.DefaultUserGroup = 'vip';
    expect(configSelfCheck(config).UserConfig.DefaultUserGroup).toBe('vip');
    config.UserConfig.Tags = [];
    expect(configSelfCheck(config).UserConfig.DefaultUserGroup).toBeUndefined();
  });

  it.each(['groups', 'all', undefined, 'invalid'])(
    'normalizes live access %s and keeps only true group grants',
    async (LiveAccess) => {
      const { configSelfCheck } = await loadConfigModule(jest.fn());
      const config = cloneBaseConfig();
      Object.assign(config.SiteConfig, { LiveAccess });
      config.UserConfig.Tags = [
        { name: 'granted', enabledApis: [], allowLive: true },
        { name: 'denied', enabledApis: [], allowLive: false },
        { name: 'default', enabledApis: [] },
      ];
      const checked = configSelfCheck(config);
      expect(checked.SiteConfig.LiveAccess).toBe(
        LiveAccess === 'groups' ? 'groups' : 'all',
      );
      expect(checked.UserConfig.Tags).toEqual([
        { name: 'granted', enabledApis: [], allowLive: true },
        { name: 'denied', enabledApis: [] },
        { name: 'default', enabledApis: [] },
      ]);
    },
  );

  it('returns cloned config objects', async () => {
    const { getConfig } = await loadConfigModule(jest.fn());
    const first = await getConfig();

    first.SiteConfig.SiteName = 'Mutated';

    const second = await getConfig();
    expect(second.SiteConfig.SiteName).toBe('IceTV');
  });

  it('stops retrying persistence after repeated compare-and-set conflicts', async () => {
    const compareAndSetAdminConfig = jest.fn().mockResolvedValue(false);
    const { getConfig } = await loadConfigModule(jest.fn(), {
      getAdminConfig: jest.fn().mockResolvedValue(null),
      compareAndSetAdminConfig,
    });

    await expect(getConfig()).resolves.toBeTruthy();
    expect(compareAndSetAdminConfig).toHaveBeenCalledTimes(3);
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

  it('collapses concurrent reads into a single database load', async () => {
    const deferred = createDeferred<AdminConfig>();
    const getAdminConfig = jest.fn().mockReturnValue(deferred.promise);
    const { getConfigForRead } = await loadConfigModule(jest.fn(), {
      getAdminConfig,
    });

    const reads = Promise.all([
      getConfigForRead(),
      getConfigForRead(),
      getConfigForRead(),
    ]);
    deferred.resolve(cloneBaseConfig());
    const [first, second, third] = await reads;

    expect(getAdminConfig).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('keeps saved config when a load is still in flight', async () => {
    const deferred = createDeferred<AdminConfig>();
    let call = 0;
    const getAdminConfig = jest.fn().mockImplementation(() => {
      call += 1;
      return call === 1 ? deferred.promise : Promise.resolve(cloneBaseConfig());
    });
    const { getConfigForRead, saveConfig } = await loadConfigModule(jest.fn(), {
      getAdminConfig,
    });

    const pendingRead = getConfigForRead();
    const saved = cloneBaseConfig();
    saved.SiteConfig.SiteName = 'Saved';
    await saveConfig(saved);

    deferred.resolve(cloneBaseConfig());
    await pendingRead;

    const after = await getConfigForRead();
    expect(after.SiteConfig.SiteName).toBe('Saved');
  });

  it('reflects a saved site name in the public config immediately', async () => {
    const { getConfig, saveConfig, getPublicConfig } = await loadConfigModule(
      jest.fn(),
    );
    const current = await getConfig();
    expect((await getPublicConfig()).SiteName).toBe('IceTV');

    await saveConfig({
      ...current,
      SiteConfig: { ...current.SiteConfig, SiteName: 'Next' },
    });

    expect((await getPublicConfig()).SiteName).toBe('Next');
  });

  it('reflects a saved custom category in the public config immediately', async () => {
    const { getConfig, saveConfig, getPublicConfig } = await loadConfigModule(
      jest.fn(),
    );
    const current = await getConfig();
    expect((await getPublicConfig()).CustomCategories).toHaveLength(0);

    await saveConfig({
      ...current,
      CustomCategories: [
        {
          name: '新分类',
          type: 'movie',
          query: 'fresh',
          from: 'custom',
          disabled: false,
        },
      ],
    });

    const publicConfig = await getPublicConfig();
    expect(publicConfig.CustomCategories).toEqual([
      { name: '新分类', type: 'movie', query: 'fresh' },
    ]);
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

  it('hides admin-only sources from regular users', async () => {
    const adminConfig = cloneBaseConfig();
    adminConfig.SourceConfig = [
      { key: 'open', name: 'Open', api: 'https://a.example', from: 'custom' },
      {
        key: 'relay',
        name: 'Relay',
        api: 'https://b.example',
        from: 'custom',
        adminOnly: true,
      },
    ];
    const { getAvailableApiSites } = await loadConfigModule(jest.fn(), {
      adminConfig,
      userAccess: { alice: { role: 'user' }, bob: { role: 'admin' } },
    });
    const keys = async (user?: string) =>
      (await getAvailableApiSites(user)).map((site) => site.key);

    await expect(keys('alice')).resolves.toEqual(['open']);
    await expect(keys('guest-without-record')).resolves.toEqual(['open']);
    await expect(keys('bob')).resolves.toEqual(['open', 'relay']);
    await expect(keys('owner-1')).resolves.toEqual(['open', 'relay']);
    await expect(keys()).resolves.toEqual(['open', 'relay']);
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

    expect(config.UserConfig.Users).toBeUndefined();
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
    saveAdminConfig.mockClear();

    await expect(saveConfig(config)).rejects.toThrow(ConfigConflictError);
    expect(saveAdminConfig).not.toHaveBeenCalled();
  });

  it('serves cached config when a later read fails', async () => {
    process.env.CONFIG_CACHE_TTL_MS = '0';
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
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
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '获取管理员配置失败:',
      expect.any(Error),
    );
  });

  it('throws instead of persisting defaults when the first read fails', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const saveAdminConfig = jest.fn();
    const getAdminConfig = jest
      .fn()
      .mockRejectedValue(new Error('read failed'));
    const { getConfig } = await loadConfigModule(saveAdminConfig, {
      getAdminConfig,
    });

    await expect(getConfig()).rejects.toThrow('read failed');
    expect(saveAdminConfig).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '获取管理员配置失败:',
      expect.any(Error),
    );
  });

  it('defaults missing fluid search config to enabled', async () => {
    const { configSelfCheck } = await loadConfigModule(jest.fn());
    const config = cloneBaseConfig();
    delete (config.SiteConfig as Partial<typeof config.SiteConfig>).FluidSearch;

    expect(configSelfCheck(config).SiteConfig.FluidSearch).toBe(true);
  });

  it('fills playback fault tolerance defaults for older site config', async () => {
    const { configSelfCheck } = await loadConfigModule(jest.fn());
    const config = cloneBaseConfig();
    const siteConfig = config.SiteConfig as Partial<typeof config.SiteConfig>;
    delete siteConfig.AutoSwitchSource;
    delete siteConfig.VodFragmentTimeoutSeconds;

    const checked = configSelfCheck(config);

    expect(checked.SiteConfig.AutoSwitchSource).toBe(false);
    expect(checked.SiteConfig.VodFragmentTimeoutSeconds).toBe(10);
  });

  it('exposes playback fault tolerance settings in public config', async () => {
    const adminConfig = cloneBaseConfig();
    adminConfig.SiteConfig.AutoSwitchSource = true;
    adminConfig.SiteConfig.VodFragmentTimeoutSeconds = 99;
    const { getPublicConfig } = await loadConfigModule(jest.fn(), {
      adminConfig,
    });

    await expect(getPublicConfig()).resolves.toMatchObject({
      AutoSwitchSource: true,
      VodFragmentTimeoutSeconds: 60,
    });
  });

  it('exposes public-safe proxy defaults in public config', async () => {
    const adminConfig = cloneBaseConfig();
    adminConfig.SiteConfig.DoubanProxyType = 'server';
    adminConfig.SiteConfig.DoubanImageProxyType = 'cmliussss-cdn-ali';
    const { getPublicConfig } = await loadConfigModule(jest.fn(), {
      adminConfig,
    });

    await expect(getPublicConfig()).resolves.toMatchObject({
      DoubanProxyType: 'auto',
      DoubanImageProxyType: 'cmliussss-cdn-ali',
    });
  });

  it('falls back custom proxy defaults in public config', async () => {
    const adminConfig = cloneBaseConfig();
    adminConfig.SiteConfig.DoubanProxyType = 'custom';
    adminConfig.SiteConfig.DoubanImageProxyType = 'custom';
    const { getPublicConfig } = await loadConfigModule(jest.fn(), {
      adminConfig,
    });

    await expect(getPublicConfig()).resolves.toMatchObject({
      DoubanProxyType: 'auto',
      DoubanImageProxyType: 'auto',
    });
  });

  it('normalizes site proxy modes and drops unknown site settings', async () => {
    const { configSelfCheck } = await loadConfigModule(jest.fn());
    const config = cloneBaseConfig();
    Object.assign(config.SiteConfig, {
      DoubanProxyType: 'custom',
      DoubanImageProxyType: 'custom',
      DoubanProxy: 'https://data.example/fetch?url=',
      DoubanImageProxy: 'https://image.example/fetch?url=',
      UnknownSetting: true,
    });

    const checked = configSelfCheck(config);

    expect(checked.SiteConfig).toEqual({
      ...baseConfig.SiteConfig,
      DoubanProxyType: 'auto',
      DoubanImageProxyType: 'auto',
    });
  });

  it('loads legacy site settings through the whitelist and persists only supported fields', async () => {
    const adminConfig = cloneBaseConfig();
    Object.assign(adminConfig.SiteConfig, { UnknownSetting: true });
    const expectedSiteConfig = { ...baseConfig.SiteConfig };
    const compareAndSetAdminConfig = jest.fn().mockResolvedValue(true);
    const { getConfigForRead } = await loadConfigModule(jest.fn(), {
      adminConfig,
      compareAndSetAdminConfig,
    });

    const loaded = await getConfigForRead();

    expect(loaded.SiteConfig).toEqual(expectedSiteConfig);
    expect(compareAndSetAdminConfig).toHaveBeenCalledTimes(1);
    expect(compareAndSetAdminConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        SiteConfig: expect.objectContaining({ UnknownSetting: true }),
      }),
      expect.objectContaining({ SiteConfig: expectedSiteConfig }),
    );
  });

  it('preserves all supported site settings during config self check', async () => {
    const { configSelfCheck } = await loadConfigModule(jest.fn());
    const config = cloneBaseConfig();
    config.SiteConfig.DisableYellowFilter = true;
    const originalSiteConfig = { ...config.SiteConfig };

    expect(configSelfCheck(config).SiteConfig).toEqual(originalSiteConfig);
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
