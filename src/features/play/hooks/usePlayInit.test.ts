import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { usePlayInit } from '@/features/play/hooks/usePlayInit';
import type { HistoryRestoreGate } from '@/features/play/hooks/usePlayProgress';
import { peekResolvedLazyEpisodeUrl } from '@/features/play/lib/lazyEpisode';
import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';
import { buildVodProxyUrl } from '@/features/play/lib/vodProxyUrl';
import { generateStorageKey } from '@/lib/db.client';
import { cacheManager } from '@/lib/db.client.cache';
import { PLAY_INTENT_KEY, savePlayIntent } from '@/lib/play-intent';
import { prefetchM3U8 } from '@/lib/player-runtime';
import { isServerProxy } from '@/lib/proxy-modes';
import {
  isTrustedSourcePlaybackStat,
  readSourcePlaybackStats,
  recordSourcePlaybackSuccess,
} from '@/lib/source-playback-stats';
import type { PlayRecord, SearchResult } from '@/lib/types';

jest.mock('@/features/play/lib/vodProbe', () => ({
  probeVodEpisodeUrl: jest.fn(),
}));

jest.mock('@/lib/player-runtime', () => ({
  prefetchM3U8: jest.fn(),
}));

type UsePlayInitParams = Parameters<typeof usePlayInit>[0];
type PlaylistBehavior = 'ok' | 'hang';

const TITLE = '测试剧';
const probeMock = probeVodEpisodeUrl as jest.MockedFunction<
  typeof probeVodEpisodeUrl
>;
const PASSING_PROBE = {
  quality: '1080p',
  loadSpeed: '2.0 MB/s',
  pingTime: 120,
};

function createSource(
  source: string,
  episodeUrl = `https://${source}.example/0.m3u8`,
): SearchResult {
  return {
    id: `${source}-id`,
    title: TITLE,
    poster: '',
    episodes: [episodeUrl],
    episodes_titles: ['第1集'],
    source,
    source_name: source.toUpperCase(),
    year: '2024',
  };
}

function createSeries(source: string, episodeCount: number): SearchResult {
  const episodes = Array.from(
    { length: episodeCount },
    (_, index) => `https://${source}.example/${index}.m3u8`,
  );
  return {
    ...createSource(source),
    episodes,
    episodes_titles: episodes.map((_, index) => `第${index + 1}集`),
  };
}

// 播放记录按登录用户分区，读写前先带上登录态
function signIn() {
  document.cookie = `auth_meta=${encodeURIComponent(
    JSON.stringify({ username: 'tester' }),
  )}`;
}

function createPlayRecords(
  source: SearchResult,
  episodeIndex: number,
): Record<string, PlayRecord> {
  return {
    [generateStorageKey(source.source, source.id)]: {
      title: source.title,
      source_name: source.source_name,
      year: source.year,
      cover: '',
      index: episodeIndex + 1,
      total_episodes: source.episodes.length,
      play_time: 600,
      total_time: 1500,
      save_time: Date.now(),
    },
  };
}

function cachePlayRecord(source: SearchResult, episodeIndex: number) {
  signIn();
  const records = createPlayRecords(source, episodeIndex);
  cacheManager.cachePlayRecords(records);
  return records;
}

// 按统计模块自身的判定累积成功记录，测试不复制可信阈值
function markTrusted(sourceKey: string) {
  const isTrusted = () =>
    isTrustedSourcePlaybackStat(readSourcePlaybackStats().get(sourceKey));
  for (let attempt = 0; attempt < 20 && !isTrusted(); attempt += 1) {
    recordSourcePlaybackSuccess(sourceKey, 800);
  }
  expect(isTrusted()).toBe(true);
}

// 与播放器首次请求清单的构造方式一致
function playerPlaylistUrl(sourceKey: string, episodeUrl: string) {
  return buildVodProxyUrl({
    rawUrl: episodeUrl,
    useServerProxy: isServerProxy(sourceKey, episodeUrl),
    sourceKey,
    playbackRequestMode: 'initial',
  });
}

function installFetch(
  playlists: Record<string, PlaylistBehavior>,
  lazyEpisodeUrls: Record<string, string> = {},
  apiResponses: Record<string, Promise<unknown>> = {},
) {
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    const target = url.searchParams.get('url') || '';
    const apiResponse = apiResponses[url.pathname];
    if (apiResponse) {
      return apiResponse.then((body) => ({
        ok: true,
        status: 200,
        json: async () => body,
      }));
    }
    if (url.pathname === '/api/proxy/m3u8') {
      const behavior = playlists[target];
      if (behavior === 'ok') {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => '#EXTM3U\n#EXTINF:4.000000,\nseg-0.ts',
        });
      }
      if (behavior === 'hang') {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        body: { cancel: async () => undefined },
      });
    }
    if (url.pathname === '/api/episode-url' && lazyEpisodeUrls[target]) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ url: lazyEpisodeUrls[target] }),
      });
    }
    return Promise.reject(new Error(`unexpected request: ${url.pathname}`));
  }) as unknown as typeof fetch;
}

function playlistRequests(): string[] {
  return (global.fetch as jest.Mock).mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.startsWith('/api/proxy/m3u8?'));
}

function apiRequests(pathname: string): string[] {
  return (global.fetch as jest.Mock).mock.calls
    .map(([input]) => String(input))
    .filter(
      (url) => new URL(url, window.location.origin).pathname === pathname,
    );
}

function probeOnly(passingUrls: string[]) {
  probeMock.mockImplementation(async (rawUrl) => {
    if (passingUrls.includes(rawUrl)) return PASSING_PROBE;
    throw new Error('Failed to load playlist');
  });
}

function createHistoryRestoreGate(): HistoryRestoreGate {
  return { playRecords: null, settledKey: '', listeners: new Set() };
}

// 传 null 时不带聚合分组，走搜索接口取候选源
function setupHook(
  aggregateGroup: SearchResult[] | null,
  overrides: Partial<UsePlayInitParams> = {},
) {
  if (aggregateGroup) {
    sessionStorage.setItem('aggregate_group', JSON.stringify(aggregateGroup));
  }
  const params: UsePlayInitParams = {
    currentSource: '',
    currentId: '',
    currentSourceRef: { current: '' },
    currentIdRef: { current: '' },
    playbackStartedSourceRef: { current: null },
    videoTitle: TITLE,
    searchTitle: TITLE,
    searchType: '',
    needPreferRef: { current: true },
    videoTitleRef: { current: TITLE },
    videoYearRef: { current: '' },
    currentEpisodeIndex: 0,
    optimizationEnabled: true,
    historyRestoreGateRef: { current: createHistoryRestoreGate() },
    setLoading: jest.fn(),
    setLoadingStage: jest.fn(),
    setLoadingMessage: jest.fn(),
    setError: jest.fn(),
    setDetail: jest.fn(),
    setCurrentSource: jest.fn(),
    setCurrentId: jest.fn(),
    setVideoTitle: jest.fn(),
    setVideoYear: jest.fn(),
    setVideoCover: jest.fn(),
    setVideoDoubanId: jest.fn(),
    setCurrentEpisodeIndex: jest.fn(),
    setNeedPrefer: jest.fn(),
    setAvailableSources: jest.fn(),
    setSourceSearchLoading: jest.fn(),
    setSourceSearchError: jest.fn(),
    setPrecomputedVideoInfo: jest.fn(),
    setSourceRecommendation: jest.fn(),
    ...overrides,
  };
  renderHook(() => usePlayInit(params));
  return params;
}

// 模拟页面提交当前源后同步 ref，起播和换源都走这一步
function setPageCurrentSource(params: UsePlayInitParams, source: SearchResult) {
  params.currentSourceRef.current = source.source;
  params.currentIdRef.current = source.id;
}

// 模拟页面确认该源真实起播
function setPagePlaybackStarted(
  params: UsePlayInitParams,
  source: SearchResult,
) {
  params.playbackStartedSourceRef.current = {
    source: source.source,
    id: source.id,
  };
}

const originalFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', `/play?title=${TITLE}`);
  probeMock.mockReset();
  (prefetchM3U8 as jest.Mock).mockClear();
});

afterEach(() => {
  cleanup();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  global.fetch = originalFetch;
});

describe('usePlayInit 常用源直接起播', () => {
  const trusted = createSource('a');
  const other = createSource('b');

  it('目标集清单不可用时回到常规测速并选测通的源', async () => {
    markTrusted('a');
    installFetch({});
    probeOnly([other.episodes[0]]);

    const params = setupHook([other, trusted]);

    await waitFor(() =>
      expect(params.setCurrentSource).toHaveBeenCalledWith('b'),
    );
    expect(params.setCurrentSource).toHaveBeenCalledTimes(1);
    expect(playlistRequests()).toEqual([
      playerPlaylistUrl('a', trusted.episodes[0]),
    ]);
    expect(probeMock.mock.calls.map(([url]) => url).sort()).toEqual([
      trusted.episodes[0],
      other.episodes[0],
    ]);
  });

  it('清单检查到时限即放弃直接起播', async () => {
    markTrusted('a');
    installFetch({ [trusted.episodes[0]]: 'hang' });
    probeOnly([other.episodes[0]]);

    const params = setupHook([other, trusted]);

    await waitFor(() => expect(playlistRequests()).toHaveLength(1));
    expect(probeMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(3_000);

    await waitFor(() =>
      expect(params.setCurrentSource).toHaveBeenCalledWith('b'),
    );
    expect(params.setCurrentSource).toHaveBeenCalledTimes(1);
  });

  it('目标集清单可用时直接起播，测速推迟到后台', async () => {
    markTrusted('a');
    installFetch({ [trusted.episodes[0]]: 'ok' });
    probeOnly([trusted.episodes[0], other.episodes[0]]);

    const params = setupHook([other, trusted]);

    await waitFor(() =>
      expect(params.setCurrentSource).toHaveBeenCalledWith('a'),
    );
    expect(playlistRequests()).toEqual([
      playerPlaylistUrl('a', trusted.episodes[0]),
    ]);
    expect(probeMock).not.toHaveBeenCalled();
    expect(prefetchM3U8).toHaveBeenCalledWith(
      playerPlaylistUrl('b', other.episodes[0]),
    );

    jest.runOnlyPendingTimers();

    await waitFor(() => expect(probeMock).toHaveBeenCalledTimes(2));
    expect(probeMock.mock.calls.map(([url]) => url)).toEqual([
      trusted.episodes[0],
      other.episodes[0],
    ]);
    expect(params.setSourceRecommendation).not.toHaveBeenCalledWith(
      expect.objectContaining({ sourceName: 'B' }),
    );
  });

  it('直接起播后后台测出当前源失败时推荐测通的源，不自动换源', async () => {
    markTrusted('a');
    installFetch({ [trusted.episodes[0]]: 'ok' });
    probeOnly([other.episodes[0]]);

    const params = setupHook([other, trusted]);

    await waitFor(() =>
      expect(params.setCurrentSource).toHaveBeenCalledWith('a'),
    );
    setPageCurrentSource(params, trusted);
    jest.runOnlyPendingTimers();

    await waitFor(() =>
      expect(params.setSourceRecommendation).toHaveBeenCalledWith({
        sourceName: 'B',
        quality: PASSING_PROBE.quality,
        loadSpeed: PASSING_PROBE.loadSpeed,
      }),
    );
    expect(params.setCurrentSource).toHaveBeenCalledTimes(1);
    expect(params.setCurrentId).toHaveBeenCalledTimes(1);
    expect(params.setDetail).toHaveBeenCalledTimes(1);
    expect(params.setDetail).toHaveBeenCalledWith(trusted);
  });

  it('直接起播的源测速失败但页面已换到测通的源时，不推荐正在播的源', async () => {
    markTrusted('a');
    installFetch({ [trusted.episodes[0]]: 'ok' });
    probeOnly([other.episodes[0]]);

    const params = setupHook([other, trusted]);

    await waitFor(() =>
      expect(params.setCurrentSource).toHaveBeenCalledWith('a'),
    );
    setPageCurrentSource(params, other);
    jest.runOnlyPendingTimers();

    await waitFor(() =>
      expect(params.setPrecomputedVideoInfo).toHaveBeenCalledTimes(2),
    );
    expect(params.setSourceRecommendation).not.toHaveBeenCalledWith(
      expect.objectContaining({ sourceName: 'B' }),
    );
  });

  it('页面从直接起播的源换走后，它测速最优也不推荐换回', async () => {
    markTrusted('a');
    installFetch({ [trusted.episodes[0]]: 'ok' });
    probeMock.mockImplementation(async (rawUrl) =>
      rawUrl === trusted.episodes[0]
        ? PASSING_PROBE
        : { quality: '480p', loadSpeed: '200 KB/s', pingTime: 900 },
    );

    const params = setupHook([other, trusted]);

    await waitFor(() =>
      expect(params.setCurrentSource).toHaveBeenCalledWith('a'),
    );
    setPageCurrentSource(params, other);
    jest.runOnlyPendingTimers();

    await waitFor(() =>
      expect(params.setPrecomputedVideoInfo).toHaveBeenCalledTimes(2),
    );
    expect(params.setSourceRecommendation).not.toHaveBeenCalledWith(
      expect.objectContaining({ sourceName: 'A' }),
    );
  });

  it('当前源已真实起播时后台测速跳过它，其他候选照常测', async () => {
    markTrusted('a');
    installFetch({ [trusted.episodes[0]]: 'ok' });
    probeOnly([other.episodes[0]]);

    const params = setupHook([other, trusted]);

    await waitFor(() =>
      expect(params.setCurrentSource).toHaveBeenCalledWith('a'),
    );
    setPageCurrentSource(params, trusted);
    setPagePlaybackStarted(params, trusted);
    jest.runOnlyPendingTimers();

    await waitFor(() =>
      expect(params.setPrecomputedVideoInfo).toHaveBeenCalledTimes(1),
    );
    expect(probeMock.mock.calls.map(([url]) => url)).toEqual([
      other.episodes[0],
    ]);
    expect(params.setSourceRecommendation).not.toHaveBeenCalledWith(
      expect.objectContaining({ sourceName: 'B' }),
    );
  });

  it('页面已从起播的源换到还没起播的源时，两个源都照常测速', async () => {
    markTrusted('a');
    installFetch({ [trusted.episodes[0]]: 'ok' });
    probeOnly([trusted.episodes[0], other.episodes[0]]);

    const params = setupHook([other, trusted]);

    await waitFor(() =>
      expect(params.setCurrentSource).toHaveBeenCalledWith('a'),
    );
    setPageCurrentSource(params, trusted);
    setPagePlaybackStarted(params, trusted);
    setPageCurrentSource(params, other);
    jest.runOnlyPendingTimers();

    await waitFor(() => expect(probeMock).toHaveBeenCalledTimes(2));
    expect(probeMock.mock.calls.map(([url]) => url)).toEqual([
      trusted.episodes[0],
      other.episodes[0],
    ]);
  });

  it('逐集解析的常用源在检查内解析地址，起播可直接取用解析结果', async () => {
    const lazyUrl = 'icetv-lazy://xgcartoon/video/demo/ep-1.html';
    const resolvedUrl = 'https://cdn.xigua.example/demo/index.m3u8';
    const lazySource = createSource('xigua', lazyUrl);
    markTrusted('xigua');
    installFetch({ [resolvedUrl]: 'ok' }, { [lazyUrl]: resolvedUrl });

    const params = setupHook([other, lazySource]);

    await waitFor(() =>
      expect(params.setCurrentSource).toHaveBeenCalledWith('xigua'),
    );
    expect(playlistRequests()).toEqual([
      playerPlaylistUrl('xigua', resolvedUrl),
    ]);
    expect(peekResolvedLazyEpisodeUrl('xigua', lazyUrl)).toBe(resolvedUrl);
    expect(probeMock).not.toHaveBeenCalled();
  });
});

describe('usePlayInit 按续播的集测速', () => {
  afterEach(() => {
    document.cookie = 'auth_meta=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('常用源按缓存记录里续播的集检查清单，备选预取和后台测速沿用这一集', async () => {
    const trusted = createSeries('a', 3);
    const other = createSeries('b', 3);
    markTrusted('a');
    const records = cachePlayRecord(trusted, 2);
    installFetch(
      { [trusted.episodes[2]]: 'ok' },
      {},
      { '/api/playrecords': Promise.resolve(records) },
    );
    probeOnly([trusted.episodes[2], other.episodes[2]]);

    const params = setupHook([other, trusted]);

    await waitFor(() =>
      expect(params.setCurrentSource).toHaveBeenCalledWith('a'),
    );
    expect(playlistRequests()).toEqual([
      playerPlaylistUrl('a', trusted.episodes[2]),
    ]);
    expect(prefetchM3U8).toHaveBeenCalledWith(
      playerPlaylistUrl('b', other.episodes[2]),
    );

    jest.runOnlyPendingTimers();

    await waitFor(() => expect(probeMock).toHaveBeenCalledTimes(2));
    expect(probeMock.mock.calls.map(([url]) => url)).toEqual([
      trusted.episodes[2],
      other.episodes[2],
    ]);
  });

  it('常规测速时各源按自己续播的集测，选中后备选预取沿用选中源的集', async () => {
    const resumed = createSeries('a', 3);
    const fresh = createSeries('b', 3);
    const records = cachePlayRecord(resumed, 1);
    installFetch({}, {}, { '/api/playrecords': Promise.resolve(records) });
    probeOnly([resumed.episodes[1], fresh.episodes[0]]);

    const params = setupHook([resumed, fresh]);

    await waitFor(() =>
      expect(params.setCurrentSource).toHaveBeenCalledWith('a'),
    );
    expect(probeMock.mock.calls.map(([url]) => url)).toEqual([
      resumed.episodes[1],
      fresh.episodes[0],
    ]);
    expect(prefetchM3U8).toHaveBeenCalledWith(
      playerPlaylistUrl('b', fresh.episodes[1]),
    );
  });

  it('播放记录在测速前到达时按续播的集测速，不依赖本地缓存', async () => {
    const resumed = createSeries('a', 3);
    const fresh = createSeries('b', 3);
    signIn();
    let resolveSearch!: (body: unknown) => void;
    let resolvePlayRecords!: (body: unknown) => void;
    let resolveProxyModes!: (body: unknown) => void;
    installFetch(
      {},
      {},
      {
        '/api/playrecords': new Promise((resolve) => {
          resolvePlayRecords = resolve;
        }),
        '/api/search': new Promise((resolve) => {
          resolveSearch = resolve;
        }),
        '/api/proxy-modes': new Promise((resolve) => {
          resolveProxyModes = resolve;
        }),
      },
    );
    probeOnly([resumed.episodes[2], fresh.episodes[0]]);

    const params = setupHook(null);
    await waitFor(() =>
      expect(apiRequests('/api/playrecords')).toHaveLength(1),
    );
    await act(async () => {
      resolveSearch({ results: [resumed, fresh] });
    });
    // 记录晚于选源读取本地缓存、早于测速到达，只有提前发出的这次请求能让测速用上
    await waitFor(() =>
      expect(apiRequests('/api/proxy-modes')).toHaveLength(1),
    );
    await act(async () => {
      resolvePlayRecords(createPlayRecords(resumed, 2));
    });
    expect(probeMock).not.toHaveBeenCalled();
    await act(async () => {
      resolveProxyModes({});
    });

    await waitFor(() =>
      expect(params.setCurrentSource).toHaveBeenCalledWith('a'),
    );
    expect(probeMock.mock.calls.map(([url]) => url)).toEqual([
      resumed.episodes[2],
      fresh.episodes[0],
    ]);
    expect(apiRequests('/api/playrecords')).toHaveLength(1);
  });
});

describe('usePlayInit 起播等历史恢复', () => {
  afterEach(() => {
    document.cookie = 'auth_meta=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('历史恢复一直不放行时到上限才按当前集起播', async () => {
    const series = createSeries('a', 3);
    installFetch({});

    const params = setupHook([series]);

    expect(params.setDetail).toHaveBeenCalledWith(series);
    expect(params.setLoading).not.toHaveBeenCalledWith(false);

    await act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(params.setLoading).not.toHaveBeenCalledWith(false);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(params.setLoading).toHaveBeenLastCalledWith(false);
    expect(params.setCurrentEpisodeIndex).not.toHaveBeenCalled();
  });

  it('选源路径提前发出的播放记录请求交给历史恢复复用，放行后收回', async () => {
    const series = createSeries('a', 3);
    const records = createPlayRecords(series, 2);
    signIn();
    installFetch({}, {}, { '/api/playrecords': Promise.resolve(records) });

    const params = setupHook([series]);
    const gate = params.historyRestoreGateRef.current;

    expect(params.setDetail).toHaveBeenCalledWith(series);
    expect(gate.playRecords).not.toBeNull();
    await expect(gate.playRecords).resolves.toEqual(records);
    expect(apiRequests('/api/playrecords')).toHaveLength(1);

    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(params.setLoading).toHaveBeenLastCalledWith(false);
    expect(gate.playRecords).toBeNull();
  });
});

describe('usePlayInit 直达入口读取播放记录', () => {
  afterEach(() => {
    document.cookie = 'auth_meta=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  function setupDirectHook(series: SearchResult) {
    return setupHook(null, {
      currentSource: series.source,
      currentId: series.id,
      currentSourceRef: { current: series.source },
      currentIdRef: { current: series.id },
      needPreferRef: { current: false },
    });
  }

  it('没有播放意图时与详情请求并行读取播放记录，起播交给历史恢复复用', async () => {
    const series = createSeries('direct-a', 3);
    const records = createPlayRecords(series, 2);
    let resolveDetail: (detail: SearchResult) => void = () => undefined;
    signIn();
    installFetch(
      {},
      {},
      {
        '/api/detail': new Promise<SearchResult>((resolve) => {
          resolveDetail = resolve;
        }),
        '/api/playrecords': Promise.resolve(records),
        '/api/search': Promise.resolve({ results: [] }),
      },
    );

    const params = setupDirectHook(series);

    expect(params.setDetail).not.toHaveBeenCalled();
    expect(apiRequests('/api/playrecords')).toHaveLength(1);

    await act(async () => {
      resolveDetail(series);
    });

    expect(params.setDetail).toHaveBeenCalledWith(series);
    await expect(
      params.historyRestoreGateRef.current.playRecords,
    ).resolves.toEqual(records);
    expect(apiRequests('/api/playrecords')).toHaveLength(1);
  });

  it('带匹配的播放意图时不读播放记录，也不消费意图', async () => {
    const series = createSeries('direct-b', 3);
    signIn();
    savePlayIntent({
      source: series.source,
      id: series.id,
      episodeIndex: 2,
      resumeTime: 30,
    });
    installFetch(
      {},
      {},
      {
        '/api/detail': Promise.resolve(series),
        '/api/search': Promise.resolve({ results: [] }),
      },
    );

    const params = setupDirectHook(series);

    await waitFor(() => expect(params.setDetail).toHaveBeenCalledWith(series));
    expect(apiRequests('/api/playrecords')).toHaveLength(0);
    expect(params.historyRestoreGateRef.current.playRecords).toBeNull();
    expect(sessionStorage.getItem(PLAY_INTENT_KEY)).not.toBeNull();
  });
});
