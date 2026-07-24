import {
  deleteCachedLiveChannels,
  getCachedLiveChannels,
  parseEpgXmlForChannels,
  parseLivePlaylist,
  refreshLiveChannels,
  refreshLiveChannelSources,
} from '@/features/live/lib/live';
import { getConfigForRead } from '@/lib/config';
import {
  clearUrlGuardDnsCacheForTests,
  resetUrlGuardDnsLookupForTests,
  setUrlGuardDnsLookupForTests,
  UrlValidationError,
} from '@/lib/url-guard';

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  getConfigForRead: jest.fn(),
  saveConfig: jest.fn(),
}));

describe('refreshLiveChannels', () => {
  const originalFetch = global.fetch;
  const originalLiveRefreshConcurrency = process.env.LIVE_REFRESH_CONCURRENCY;
  const mockedGetConfigForRead = getConfigForRead as jest.MockedFunction<
    typeof getConfigForRead
  >;
  const cacheKeys = [
    'blocked-local',
    'large-playlist',
    'stale-source',
    'atomic-source',
    'limited-1',
    'limited-2',
    'limited-3',
  ];

  beforeEach(() => {
    clearUrlGuardDnsCacheForTests();
    setUrlGuardDnsLookupForTests((async (
      _hostname: string,
      options?: unknown,
    ) => {
      if (options && typeof options === 'object' && 'all' in options) {
        return [{ address: '93.184.216.34', family: 4 }];
      }

      return { address: '93.184.216.34', family: 4 };
    }) as unknown as Parameters<typeof setUrlGuardDnsLookupForTests>[0]);
    global.fetch = jest.fn();
    delete process.env.LIVE_REFRESH_CONCURRENCY;
    mockedGetConfigForRead.mockReset();
  });

  afterEach(() => {
    for (const key of cacheKeys) {
      deleteCachedLiveChannels(key);
    }
    global.fetch = originalFetch;
    resetUrlGuardDnsLookupForTests();
    clearUrlGuardDnsCacheForTests();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalLiveRefreshConcurrency === undefined) {
      delete process.env.LIVE_REFRESH_CONCURRENCY;
    } else {
      process.env.LIVE_REFRESH_CONCURRENCY = originalLiveRefreshConcurrency;
    }
  });

  it('拒绝内网直播源地址', async () => {
    await expect(
      refreshLiveChannels({
        key: 'blocked-local',
        name: 'Blocked',
        url: 'http://127.0.0.1/live.m3u',
        from: 'custom',
      }),
    ).rejects.toThrow('Blocked destination');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('拒绝超大直播源响应', async () => {
    const body = 'x'.repeat(5 * 1024 * 1024 + 1);
    (global.fetch as jest.Mock).mockResolvedValue(createTextResponse(body));

    await expect(
      refreshLiveChannels({
        key: 'large-playlist',
        name: 'Large',
        url: 'https://example.com/live.m3u',
        from: 'custom',
      }),
    ).rejects.toThrow('直播源文件过大');
  });

  it('缓存过期时先返回旧频道并在刷新失败后保留缓存', async () => {
    let currentTime = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const source = {
      key: 'stale-source',
      name: 'Stale',
      url: 'https://example.com/stale.m3u',
      from: 'custom' as const,
    };
    mockedGetConfigForRead.mockResolvedValue({
      SiteConfig: { EnableLiveEntry: true },
      LiveConfig: [source],
    } as Awaited<ReturnType<typeof getConfigForRead>>);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        createTextResponse(
          '#EXTM3U\n#EXTINF:-1,旧频道\nhttps://example.com/old.m3u8',
        ),
      )
      .mockRejectedValueOnce(new UrlValidationError('refresh failed'));

    await refreshLiveChannels(source);
    currentTime += 30 * 60 * 1000 + 1;

    const stale = await getCachedLiveChannels(source.key);
    await flushAsyncWork();
    currentTime = 1_000;
    const preserved = await getCachedLiveChannels(source.key);

    expect(stale?.channels.map((channel) => channel.name)).toEqual(['旧频道']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(preserved).toBe(stale);
  });

  it('后台刷新成功后原子替换过期缓存', async () => {
    let currentTime = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    const source = {
      key: 'atomic-source',
      name: 'Atomic',
      url: 'https://example.com/atomic.m3u',
      from: 'custom' as const,
    };
    mockedGetConfigForRead.mockResolvedValue({
      SiteConfig: { EnableLiveEntry: true },
      LiveConfig: [source],
    } as Awaited<ReturnType<typeof getConfigForRead>>);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        createTextResponse(
          '#EXTM3U\n#EXTINF:-1,旧频道\nhttps://example.com/old.m3u8',
        ),
      )
      .mockResolvedValueOnce(
        createTextResponse(
          [
            '#EXTM3U',
            '#EXTINF:-1,新频道一',
            'https://example.com/new-1.m3u8',
            '#EXTINF:-1,新频道二',
            'https://example.com/new-2.m3u8',
          ].join('\n'),
        ),
      );

    await refreshLiveChannels(source);
    currentTime += 30 * 60 * 1000 + 1;

    const stale = await getCachedLiveChannels(source.key);
    await flushAsyncWork();
    const fresh = await getCachedLiveChannels(source.key);

    expect(stale?.channels.map((channel) => channel.name)).toEqual(['旧频道']);
    expect(fresh?.channels.map((channel) => channel.name)).toEqual([
      '新频道一',
      '新频道二',
    ]);
  });

  it('批量刷新最多同时处理两个直播源', async () => {
    const pendingReads: Array<() => void> = [];
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve(
        createDeferredTextResponse(
          '#EXTM3U\n#EXTINF:-1,频道\nhttps://example.com/live.m3u8',
          (release) => pendingReads.push(release),
        ),
      ),
    );
    const sources: Parameters<typeof refreshLiveChannelSources>[0] = [
      'limited-1',
      'limited-2',
      'limited-3',
    ].map((key) => ({
      key,
      name: key,
      url: `https://example.com/${key}.m3u`,
      from: 'custom' as const,
    }));

    const refreshPromise = refreshLiveChannelSources(sources);
    await waitForCondition(() => pendingReads.length === 2);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    pendingReads.shift()?.();
    await waitForCondition(() => pendingReads.length === 2);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    pendingReads.splice(0).forEach((release) => release());
    await refreshPromise;
    expect(sources.map((source) => source.channelNumber)).toEqual([1, 1, 1]);
  });
});

function createTextResponse(body: string): Response {
  const data = Buffer.from(body);
  let consumed = false;

  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          if (consumed) {
            return { done: true, value: undefined };
          }

          consumed = true;
          return { done: false, value: data };
        },
      }),
    },
  } as unknown as Response;
}

function createDeferredTextResponse(
  body: string,
  onPending: (release: () => void) => void,
): Response {
  const data = Buffer.from(body);
  let consumed = false;

  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          if (consumed) {
            return { done: true, value: undefined };
          }

          consumed = true;
          await new Promise<void>((resolve) => onPending(resolve));
          return { done: false, value: data };
        },
      }),
    },
  } as unknown as Response;
}

async function flushAsyncWork() {
  for (let index = 0; index < 6; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function waitForCondition(condition: () => boolean) {
  for (let index = 0; index < 20; index += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Condition was not met');
}

describe('parseLivePlaylist', () => {
  it('解析文本 IPTV 分组清单', () => {
    const result = parseLivePlaylist(
      'iptv',
      [
        '央视频道,#genre#',
        'CCTV-1 综合,http://example.test/cctv1.m3u8',
        '卫视频道,#genre#',
        '湖南卫视,http://example.test/hunan.m3u8',
      ].join('\n'),
    );

    expect(result.tvgUrl).toBe('');
    expect(result.channels).toEqual([
      {
        id: 'iptv-0',
        tvgId: 'CCTV-1 综合',
        name: 'CCTV-1 综合',
        logo: '',
        group: '央视频道',
        url: 'http://example.test/cctv1.m3u8',
      },
      {
        id: 'iptv-1',
        tvgId: '湖南卫视',
        name: '湖南卫视',
        logo: '',
        group: '卫视频道',
        url: 'http://example.test/hunan.m3u8',
      },
    ]);
  });

  it('保留标准 M3U 解析', () => {
    const result = parseLivePlaylist(
      'm3u',
      [
        '#EXTM3U x-tvg-url="https://example.test/epg.xml"',
        '#EXTINF:-1 tvg-id="cctv1" tvg-name="CCTV1" tvg-logo="https://example.test/logo.png" group-title="央视",CCTV-1',
        'https://example.test/cctv1.m3u8',
      ].join('\n'),
    );

    expect(result.tvgUrl).toBe('https://example.test/epg.xml');
    expect(result.channels).toEqual([
      {
        id: 'm3u-0',
        tvgId: 'cctv1',
        name: 'CCTV-1',
        logo: 'https://example.test/logo.png',
        group: '央视',
        url: 'https://example.test/cctv1.m3u8',
      },
    ]);
  });
});

describe('parseEpgXmlForChannels', () => {
  it('通过 display-name 匹配第三方 EPG 频道', () => {
    const result = parseEpgXmlForChannels(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv>',
        '<channel id="1">',
        '<display-name lang="zh">CCTV1</display-name>',
        '</channel>',
        '<programme start="20260627000000 +0800" stop="20260627003000 +0800" channel="1">',
        '<title lang="zh">新闻联播</title>',
        '</programme>',
        '</tv>',
      ].join('\n'),
      [
        { tvgId: 'CCTV1.cn@HD', name: 'CCTV-1 (1080p)' },
        { tvgId: '', name: 'CCTV1' },
      ],
    );

    expect(result['CCTV1.cn@HD']).toEqual([
      {
        start: '20260627000000 +0800',
        end: '20260627003000 +0800',
        title: '新闻联播',
      },
    ]);
    expect(result['CCTV-1 (1080p)']).toEqual(result['CCTV1.cn@HD']);
    expect(result.CCTV1).toEqual(result['CCTV1.cn@HD']);
  });
});
