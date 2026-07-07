import type { AdminConfig } from '@/types/admin';

import {
  buildConfigFileFromAdminConfig,
  removeConfigFileEntries,
} from '../config-file-json';

describe('removeConfigFileEntries', () => {
  it('removes video source entries from api_site', () => {
    const configFile = JSON.stringify({
      cache_time: 7200,
      api_site: {
        giri: { name: 'giri资源', api: 'https://ani.girigirilove.com' },
        other: { name: '其它源', api: 'https://example.com' },
      },
      lives: {
        iptv: { name: 'IPTV', url: 'https://example.com/live.m3u' },
      },
    });

    const result = JSON.parse(
      removeConfigFileEntries(configFile, 'api_site', ['giri']),
    );

    expect(result.api_site).toEqual({
      other: { name: '其它源', api: 'https://example.com' },
    });
    expect(result.lives).toEqual({
      iptv: { name: 'IPTV', url: 'https://example.com/live.m3u' },
    });
  });

  it('removes live source entries from lives', () => {
    const configFile = JSON.stringify({
      api_site: {
        giri: { name: 'giri资源', api: 'https://ani.girigirilove.com' },
      },
      lives: {
        iptv: { name: 'IPTV', url: 'https://example.com/live.m3u' },
        other: { name: '其它直播', url: 'https://example.com/other.m3u' },
      },
    });

    const result = JSON.parse(
      removeConfigFileEntries(configFile, 'lives', ['iptv']),
    );

    expect(result.lives).toEqual({
      other: { name: '其它直播', url: 'https://example.com/other.m3u' },
    });
    expect(result.api_site).toEqual({
      giri: { name: 'giri资源', api: 'https://ani.girigirilove.com' },
    });
  });

  it('keeps invalid JSON unchanged', () => {
    const configFile = '{invalid';

    expect(removeConfigFileEntries(configFile, 'api_site', ['giri'])).toBe(
      configFile,
    );
  });
});

describe('buildConfigFileFromAdminConfig', () => {
  it('uses current admin video and live source lists', () => {
    const config: AdminConfig = {
      ConfigSubscribtion: {
        URL: '',
        AutoUpdate: false,
        LastCheck: '',
      },
      ConfigFile: JSON.stringify({
        cache_time: 7200,
        api_site: {
          old: { name: '旧视频源', api: 'https://old.example.com' },
        },
        lives: {
          'yang-1989': {
            name: 'yang-1989',
            url: 'https://old.example.com/live.m3u',
          },
        },
        custom_category: [
          {
            name: '电影',
            type: 'movie',
            query: '电影',
          },
        ],
      }),
      SiteConfig: {
        SiteName: 'IceTV',
        SiteIcon: '',
        Announcement: '',
        FooterText: '',
        EnableLiveEntry: false,
        DefaultAggregateSearch: true,
        EnableOptimization: true,
        LiveDirectConnect: false,
        SearchDownstreamMaxPage: 5,
        SiteInterfaceCacheTime: 7200,
        VodPageTimeoutSeconds: 15,
        PlaybackHistoryPageSize: 10,
        PlaybackHistoryLimit: 500,
        SearchHistoryLimit: 20,
        SearchRequestTimeoutSeconds: 8,
        SourceFailureCooldownSeconds: 300,
        ContinueWatchingLimit: 10,
        CoverImageCacheSize: 500,
        DataImportPlaybackSessionsLimit: 500,
        LivePrecheckTimeoutSeconds: 15,
        ProxyRequestTimeoutSeconds: 30,
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
      },
      SourceConfig: [
        {
          key: 'giri',
          name: 'giri资源',
          api: 'https://ani.girigirilove.com',
          detail: '',
          from: 'custom',
        },
      ],
      CustomCategories: [],
      LiveConfig: [
        {
          key: 'github',
          name: 'github',
          url: 'https://example.com/github.m3u',
          ua: '',
          epg: '',
          from: 'custom',
          channelNumber: 12,
        },
      ],
    };

    const result = JSON.parse(buildConfigFileFromAdminConfig(config));

    expect(result.api_site).toEqual({
      giri: {
        name: 'giri资源',
        api: 'https://ani.girigirilove.com',
      },
    });
    expect(result.lives).toEqual({
      github: {
        name: 'github',
        url: 'https://example.com/github.m3u',
      },
    });
    expect(result.custom_category).toEqual([
      {
        name: '电影',
        type: 'movie',
        query: '电影',
      },
    ]);
  });
});
