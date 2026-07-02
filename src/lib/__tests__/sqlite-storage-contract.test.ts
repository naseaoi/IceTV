/** @jest-environment node */

import type { AdminConfig } from '@/types/admin';

import { LocalSqliteStorage } from '../sqlite.db';
import type { Favorite, PlayRecord, SkipConfig } from '../types';

const adminConfig: AdminConfig = {
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
    Users: [],
    OpenRegister: false,
    Tags: [],
  },
  SourceConfig: [],
  CustomCategories: [],
  LiveConfig: [],
};

const playRecord: PlayRecord = {
  title: 'Demo',
  source_name: 'Source',
  cover: '',
  year: '2026',
  index: 1,
  total_episodes: 12,
  play_time: 10,
  total_time: 120,
  save_time: 1000,
  search_title: 'Demo',
};

const favorite: Favorite = {
  title: 'Demo',
  source_name: 'Source',
  cover: '',
  year: '2026',
  total_episodes: 12,
  save_time: 1000,
  search_title: 'Demo',
};

const skipConfig: SkipConfig = {
  enable: true,
  intro_time: 90,
  outro_time: 30,
};

describe('sqlite storage contract', () => {
  it('persists user scoped data and deletes it with the user', async () => {
    const storage = new LocalSqliteStorage(':memory:');

    await storage.registerUser('demo-user', 'password');
    await storage.setPlayRecord('demo-user', 'source+1', playRecord);
    await storage.setFavorite('demo-user', 'source+1', favorite);
    await storage.setSkipConfig('demo-user', 'source', '1', skipConfig);
    await storage.addSearchHistory('demo-user', 'first');
    await storage.addSearchHistory('demo-user', 'second');
    await storage.addSearchHistory('demo-user', 'first');

    await expect(storage.checkUserExist('demo-user')).resolves.toBe(true);
    await expect(
      storage.getPlayRecord('demo-user', 'source+1'),
    ).resolves.toEqual(playRecord);
    await expect(storage.getFavorite('demo-user', 'source+1')).resolves.toEqual(
      favorite,
    );
    await expect(
      storage.getSkipConfig('demo-user', 'source', '1'),
    ).resolves.toEqual(skipConfig);
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([
      'first',
      'second',
    ]);

    await storage.deleteUser('demo-user');

    await expect(storage.checkUserExist('demo-user')).resolves.toBe(false);
    await expect(storage.getAllPlayRecords('demo-user')).resolves.toEqual({});
    await expect(storage.getAllFavorites('demo-user')).resolves.toEqual({});
    await expect(storage.getAllSkipConfigs('demo-user')).resolves.toEqual({});
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([]);
  });

  it('replaces all data from an import snapshot', async () => {
    const storage = new LocalSqliteStorage(':memory:');

    await storage.replaceAllData({
      adminConfig,
      users: {
        'demo-user':
          '$2b$10$abcdefghijklmnopqrstuu9dBwFh6R0D4A5gHfHnM6kQ7xS8tT9u',
      },
      userData: {
        'demo-user': {
          playRecords: { 'source+1': playRecord },
          favorites: { 'source+1': favorite },
          searchHistory: ['first', 'second'],
          skipConfigs: { 'source+1': skipConfig },
        },
      },
    });

    await expect(storage.getAdminConfig()).resolves.toEqual(adminConfig);
    await expect(storage.getAllUsers()).resolves.toEqual(['demo-user']);
    await expect(storage.getAllPlayRecords('demo-user')).resolves.toEqual({
      'source+1': playRecord,
    });
    await expect(storage.getAllFavorites('demo-user')).resolves.toEqual({
      'source+1': favorite,
    });
    await expect(storage.getSearchHistory('demo-user')).resolves.toEqual([
      'first',
      'second',
    ]);
    await expect(storage.getAllSkipConfigs('demo-user')).resolves.toEqual({
      'source+1': skipConfig,
    });
  });
});
