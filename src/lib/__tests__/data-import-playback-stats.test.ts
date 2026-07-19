/** @jest-environment node */

import { DEFAULT_RUNTIME_PARAMS } from '@/lib/runtime-params';
import type { AdminConfig } from '@/types/admin';

jest.mock('../env.server', () => ({
  getOwnerUsername: () => 'owner',
}));

import { parseImportData } from '../data-import';
import type { PlaybackSession } from '../types';

const adminConfig: AdminConfig = {
  ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
  ConfigFile: '',
  SiteConfig: {
    SiteName: 'IceTV',
    SiteIcon: '',
    Announcement: '',
    FooterText: '',
    EnableLiveEntry: false,
    DefaultAggregateSearch: true,
    EnableOptimization: true,
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
    Users: [],
    OpenRegister: false,
    Tags: [],
  },
  SourceConfig: [],
  CustomCategories: [],
  LiveConfig: [],
};

const playbackSession: PlaybackSession = {
  id: 'session_demo_1',
  source: 'source',
  video_id: '1',
  episode_index: 1,
  title: 'Demo',
  source_name: 'Source',
  cover: '',
  year: '2026',
  started_at: 1000,
  ended_at: 2000,
  watch_seconds: 60,
  last_position: 60,
  total_time: 120,
  created_at: 1000,
  updated_at: 2000,
};

function createImportData(sessionKey = playbackSession.id) {
  return {
    timestamp: '2026-07-05T00:00:00.000Z',
    serverVersion: '0.4.3',
    data: {
      adminConfig,
      userData: {
        owner: {
          playRecords: {},
          favorites: {},
          searchHistory: [],
          skipConfigs: {},
          playbackSessions: {
            [sessionKey]: {
              ...playbackSession,
              id: 'ignored-session-id',
            },
          },
        },
      },
    },
  };
}

describe('data import playback stats', () => {
  it('keeps playback sessions from backup data', async () => {
    const parsed = await parseImportData(createImportData());

    expect(
      parsed.snapshot.userData.owner.playbackSessions[playbackSession.id],
    ).toEqual(playbackSession);
  });

  it('rejects invalid playback session keys', async () => {
    await expect(parseImportData(createImportData('bad id'))).rejects.toThrow(
      '播放统计 key 格式无效',
    );
  });

  it('keeps only the newest sessions when over the import limit', async () => {
    const importData = createImportData();
    importData.data.adminConfig = {
      ...adminConfig,
      SiteConfig: {
        ...adminConfig.SiteConfig,
        DataImportPlaybackSessionsLimit: 2,
      },
    };
    importData.data.userData.owner.playbackSessions = {
      session_old_1: { ...playbackSession, started_at: 1000 },
      session_new_1: { ...playbackSession, started_at: 3000 },
      session_mid_1: { ...playbackSession, started_at: 2000 },
    };

    const parsed = await parseImportData(importData);

    expect(
      Object.keys(parsed.snapshot.userData.owner.playbackSessions).sort(),
    ).toEqual(['session_mid_1', 'session_new_1']);
  });
});
