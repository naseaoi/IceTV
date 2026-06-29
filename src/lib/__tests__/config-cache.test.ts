/** @jest-environment node */

import { AdminConfig } from '@/features/admin/types/api';

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

async function loadConfigModule(saveAdminConfig: jest.Mock) {
  jest.resetModules();
  jest.doMock('@/lib/db', () => ({
    db: {
      getAdminConfig: jest.fn().mockResolvedValue(cloneBaseConfig()),
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
});
