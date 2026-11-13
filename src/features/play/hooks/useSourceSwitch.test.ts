import { renderHook, waitFor } from '@testing-library/react';
import type Artplayer from 'artplayer';
import type { SetStateAction } from 'react';

import type {
  PlaybackRequestMode,
  VideoQualityInfo,
} from '@/features/play/hooks/usePlayPageState';
import { useSourceSwitch } from '@/features/play/hooks/useSourceSwitch';
import { holdBackgroundSourceProbes } from '@/features/play/lib/sourceProbeStore';
import { reportVodPlaybackOutcome } from '@/features/play/lib/vodPlaybackIntent';
import { deletePlayRecord, deleteSkipConfig } from '@/lib/db.client';
import {
  AUTO_SWITCH_SOURCE_STORAGE_KEY,
  readDanmakuEpisodeId,
  readDanmakuEpisodeSearchTitle,
  writeDanmakuEpisodeId,
  writeDanmakuEpisodeSearchTitle,
} from '@/lib/local-preferences';
import type { ManagedVideoElement } from '@/lib/player-runtime';
import {
  readSourcePlaybackStats,
  recordSourcePlaybackSuccess,
} from '@/lib/source-playback-stats';
import { reportSourcePlayOutcome } from '@/lib/source-route-stats.client';
import type { SearchResult } from '@/lib/types';

jest.mock('@/features/play/lib/sourceProbeStore', () => ({
  ...jest.requireActual('@/features/play/lib/sourceProbeStore'),
  holdBackgroundSourceProbes: jest.fn(),
}));

jest.mock('@/lib/source-route-stats.client', () => ({
  reportSourcePlayOutcome: jest.fn(),
}));

jest.mock('@/lib/db.client', () => ({
  deletePlayRecord: jest.fn(),
  deleteSkipConfig: jest.fn(),
  saveSkipConfig: jest.fn(),
}));

jest.mock('@/lib/play-intent', () => ({
  savePlayIntent: jest.fn(),
}));

type MockSelectionContext = {
  proxyModes: Record<string, string>;
  healthTiers: Record<string, string>;
};
let mockSelectionContext: MockSelectionContext = {
  proxyModes: {},
  healthTiers: {},
};

jest.mock('@/features/play/lib/sourceSelectionContext', () => ({
  peekSourceSelectionContext: () => mockSelectionContext,
}));

const mockGetVodRuntimeSourceUrl = jest.fn<string | null, [HTMLVideoElement]>(
  () => null,
);

jest.mock('@/features/play/lib/vodHlsRuntime', () => ({
  getVodRuntimeSourceUrl: (video: HTMLVideoElement) =>
    mockGetVodRuntimeSourceUrl(video),
}));

type UseSourceSwitchOptions = Parameters<typeof useSourceSwitch>[0];

const THREE_EPISODES = ['第1集', '第2集', '第3集'];

function createSource(source: string, episodeTitles: string[]): SearchResult {
  return {
    id: `${source}-id`,
    title: '测试剧',
    poster: '',
    episodes: episodeTitles.map(
      (_, index) => `https://${source}.example/${index}.m3u8`,
    ),
    episodes_titles: episodeTitles,
    source,
    source_name: source.toUpperCase(),
    year: '2024',
  };
}

// 懒解析候选的剧集结构以详情为准，换源仍先等详情；用于覆盖等待详情窗口内的行为
function createLazySource(
  source: string,
  episodeTitles: string[],
): SearchResult {
  return {
    ...createSource(source, episodeTitles),
    episodes: episodeTitles.map(
      (_, index) => `icetv-lazy://test/${source}/${index}`,
    ),
  };
}

// 第一个为当前源，其余为需要先等详情的懒解析候选
function createWaitingSources(keys: string[]): SearchResult[] {
  return keys.map((key, index) =>
    index === 0
      ? createSource(key, THREE_EPISODES)
      : createLazySource(key, THREE_EPISODES),
  );
}

function info(loadSpeed: string): VideoQualityInfo {
  return { quality: '1080p', loadSpeed, pingTime: 100 };
}

function createLoadingVideo() {
  const video = document.createElement('video') as ManagedVideoElement;
  const pause = jest.fn();
  const runtimeCleanup = jest.fn();
  const stopLoad = jest.fn();
  video.pause = pause;
  video.__icetvHlsCleanup = runtimeCleanup;
  video.hls = { stopLoad } as unknown as ManagedVideoElement['hls'];
  return { video, pause, runtimeCleanup, stopLoad };
}

function setupHook({
  availableSources,
  fullDetails = {},
  videoInfo = new Map(),
  video = null,
  playerCurrentTime = 0,
  videoUrl = '',
}: {
  availableSources: SearchResult[];
  fullDetails?: Record<string, SearchResult>;
  videoInfo?: ReadonlyMap<string, VideoQualityInfo>;
  video?: HTMLVideoElement | null;
  playerCurrentTime?: number;
  videoUrl?: string;
}) {
  const [current] = availableSources;
  const currentSourceRef = { current: current.source };
  const currentIdRef = { current: current.id };
  const detailRef = { current: current as SearchResult | null };
  const player = video
    ? {
        video,
        currentTime: playerCurrentTime,
        notice: { show: '' },
        pause: jest.fn(),
      }
    : null;

  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${url.searchParams.get('source')}-${url.searchParams.get('id')}`;
    const detail =
      fullDetails[key] ??
      availableSources.find((item) => `${item.source}-${item.id}` === key);
    return { ok: true, json: async () => detail } as Response;
  });

  const options: UseSourceSwitchOptions = {
    availableSources,
    precomputedVideoInfo: videoInfo,
    currentEpisodeIndex: 2,
    artPlayerRef: { current: player as unknown as Artplayer | null },
    currentSourceRef,
    currentIdRef,
    detailRef,
    currentEpisodeIndexRef: { current: 2 },
    skipConfigRef: {
      current: { enable: false, intro_time: 0, outro_time: 0 },
    },
    resumeTimeRef: { current: null },
    resumeModeRef: { current: null },
    stableCurrentTimeRef: { current: 0 },
    clearTargetEpisodeProgressRef: { current: false },
    sourceSwitchEpisodeAnchorRef: { current: null },
    playbackRequestModeRef: { current: 'initial' as PlaybackRequestMode },
    pendingSourceSwitchCleanupRef: { current: null },
    sourceChangeRequestIdRef: { current: 0 },
    videoUrlRef: { current: videoUrl },
    setError: jest.fn(),
    setVideoUrl: jest.fn(),
    setVideoTitle: jest.fn(),
    setVideoYear: jest.fn(),
    setVideoCover: jest.fn(),
    setVideoDoubanId: jest.fn(),
    setCurrentSource: jest.fn((value: SetStateAction<string>) => {
      if (typeof value === 'string') currentSourceRef.current = value;
    }),
    setCurrentId: jest.fn((value: SetStateAction<string>) => {
      if (typeof value === 'string') currentIdRef.current = value;
    }),
    setDetail: jest.fn((value: SetStateAction<SearchResult | null>) => {
      if (typeof value !== 'function') detailRef.current = value;
    }),
    setCurrentEpisodeIndex: jest.fn(),
    setAvailableSources: jest.fn(),
    setIsVideoLoading: jest.fn(),
    setVideoLoadingStage: jest.fn(),
    setVideoLoadingAttempt: jest.fn(),
    setPlaybackRetryNonce: jest.fn(),
    setRealtimeLoadSpeed: jest.fn(),
    setSourceSearchError: jest.fn(),
    cleanupPlayer: jest.fn(),
    registerSkipConfigMigration: jest.fn().mockResolvedValue(true),
    onPlaybackStartFailed: jest.fn(),
  };

  const { result } = renderHook(() => useSourceSwitch(options));
  return { result, options, player };
}

function fetchedDetailUrls(): string[] {
  return (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url));
}

// 挂起下一次详情请求，模拟等待新源详情的窗口；返回值用于放行
function holdNextDetailFetch(): () => void {
  const fetchMock = global.fetch as jest.Mock;
  const respond = fetchMock.getMockImplementation();
  let release: () => void = () => undefined;
  fetchMock.mockImplementationOnce(
    (...args: unknown[]) =>
      new Promise((resolve) => {
        release = () => resolve(respond?.(...args));
      }),
  );
  return () => release();
}

// 下一次详情请求一直不返回，直到被中止；返回值读取请求收到的中止信号
function hangNextDetailFetch(): () => AbortSignal | undefined {
  const fetchMock = global.fetch as jest.Mock;
  let signal: AbortSignal | undefined;
  fetchMock.mockImplementationOnce(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      }),
  );
  return () => signal;
}

describe('useSourceSwitch 自动换源', () => {
  it('仅提交新源时登记迁移，进度保存后等待迁移再清理旧配置', async () => {
    const sources = createWaitingSources(['a', 'b']);
    const { result, options } = setupHook({ availableSources: sources });
    const config = { enable: true, intro_time: 15, outro_time: -20 };
    options.skipConfigRef.current = config;
    let resolve!: (saved: boolean) => void;
    jest.mocked(options.registerSkipConfigMigration).mockReturnValueOnce(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    jest.mocked(deletePlayRecord).mockClear();
    jest.mocked(deleteSkipConfig).mockClear();
    const release = holdNextDetailFetch();
    const switching = result.current.handleSourceChange('b', 'b-id', '测试剧');
    expect(options.registerSkipConfigMigration).not.toHaveBeenCalled();
    release();
    await switching;
    expect(options.registerSkipConfigMigration).toHaveBeenCalledWith(
      'b',
      'b-id',
      config,
    );
    expect(deletePlayRecord).not.toHaveBeenCalled();
    await result.current.finalizePendingSourceSwitchCleanup('a', 'a-id');
    expect(deletePlayRecord).not.toHaveBeenCalled();
    const cleanup = result.current.finalizePendingSourceSwitchCleanup(
      'b',
      'b-id',
    );
    await Promise.resolve();
    expect(deletePlayRecord).toHaveBeenCalledWith('a', 'a-id');
    expect(deleteSkipConfig).not.toHaveBeenCalled();
    resolve(true);
    await cleanup;
    expect(deleteSkipConfig).toHaveBeenCalledWith('a', 'a-id');
  });

  it('等待详情期间取消换源时不登记迁移', async () => {
    const { result, options } = setupHook({
      availableSources: createWaitingSources(['a', 'b']),
    });
    const release = holdNextDetailFetch();
    const switching = result.current.handleSourceChange('b', 'b-id', '测试剧');
    result.current.resetAutoSourceSwitch();
    release();
    await switching;
    expect(options.registerSkipConfigMigration).not.toHaveBeenCalled();
    expect(options.pendingSourceSwitchCleanupRef.current).toBeNull();
  });

  it('候选缺目标集而回退旧源时不登记迁移', async () => {
    const { result, options } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createLazySource('b', ['第1集']),
      ],
    });
    await result.current.handleSourceChange('b', 'b-id', '测试剧');
    expect(options.registerSkipConfigMigration).not.toHaveBeenCalled();
    expect(options.currentSourceRef.current).toBe('a');
    expect(options.pendingSourceSwitchCleanupRef.current).toBeNull();
  });
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    jest.mocked(reportSourcePlayOutcome).mockClear();
    mockSelectionContext = { proxyModes: {}, healthTiers: {} };
    mockGetVodRuntimeSourceUrl.mockReset();
    mockGetVodRuntimeSourceUrl.mockReturnValue(null);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('未开启时页面超时和地址解析失败只停止加载并提示', () => {
    const { result, options } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createSource('b', THREE_EPISODES),
      ],
    });

    expect(result.current.handleLoadingTimeout()).toBe(false);
    expect(options.setRealtimeLoadSpeed).toHaveBeenLastCalledWith(
      '当前源加载超时',
    );

    result.current.handleEpisodeUrlResolveFailed();
    expect(options.setRealtimeLoadSpeed).toHaveBeenLastCalledWith(
      '播放地址解析失败',
    );
    expect(result.current.handlePlaybackRecoveryExhausted('fatal')).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    // 未开启自动换源也要把三处触发点报给起播统计
    expect(options.onPlaybackStartFailed).toHaveBeenCalledTimes(3);
  });

  it('离线起播超时显示可重试状态而不消耗线路和源健康', () => {
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result, options } = setupHook({
      availableSources: [createSource('a', THREE_EPISODES)],
    });
    expect(result.current.handleLoadingTimeout()).toBe(false);
    expect(options.onPlaybackStartFailed).not.toHaveBeenCalled();
    expect(result.current.playbackIntentRef.current.reportedSources.size).toBe(
      0,
    );
    expect(result.current.playbackIntentRef.current.attempts).toBe(0);
  });

  it('离线懒解析与恢复耗尽共用守卫，不消费换源或健康', () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result, options } = setupHook({
      availableSources: ['a', 'b'].map((key) =>
        createSource(key, THREE_EPISODES),
      ),
    });
    result.current.handleEpisodeUrlResolveFailed();
    result.current.handlePlaybackRecoveryExhausted('fatal');
    expect(result.current.playbackIntentRef.current.attempts).toBe(0);
    expect(reportSourcePlayOutcome).not.toHaveBeenCalled();
    expect(options.onPlaybackStartFailed).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('候选详情期间离线撤回名额并进入可重试错误，联网后能重新加载', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const online = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { video, runtimeCleanup } = createLoadingVideo();
    const { result, options } = setupHook({
      availableSources: createWaitingSources(['a', 'b']),
      video,
    });
    const release = holdNextDetailFetch();
    result.current.handlePlaybackRecoveryExhausted('fatal');
    expect(runtimeCleanup).toHaveBeenCalledTimes(1);
    online.mockReturnValue(false);
    release();
    await waitFor(() =>
      expect(options.setError).toHaveBeenLastCalledWith(
        '网络已断开，请联网后重试',
      ),
    );
    expect(options.setCurrentSource).not.toHaveBeenCalled();
    expect(options.setIsVideoLoading).toHaveBeenLastCalledWith(false);
    expect(options.setRealtimeLoadSpeed).toHaveBeenLastCalledWith('');
    expect(options.playbackRequestModeRef.current).toBe('initial');
    expect(result.current.playbackIntentRef.current.attempts).toBe(0);
    expect(reportSourcePlayOutcome).toHaveBeenCalledTimes(1);
    expect(reportSourcePlayOutcome).toHaveBeenCalledWith('a', false);
    online.mockReturnValue(true);
    result.current.resetAutoSourceSwitch();
    result.current.restartCurrentPlayback();
    expect(options.setError).toHaveBeenLastCalledWith(null);
    expect(options.setIsVideoLoading).toHaveBeenLastCalledWith(true);
    expect(options.setPlaybackRetryNonce).toHaveBeenCalledTimes(1);
    result.current.handlePlaybackRecoveryExhausted('fatal');
    await waitFor(() => expect(options.currentSourceRef.current).toBe('b'));
  });

  it('换集重置中止详情请求，迟到的 JSON 不提交且旧意图失败不计数', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const { result, options } = setupHook({
      availableSources: createWaitingSources(['a', 'b']),
    });
    let resolveBody!: (value: SearchResult) => void;
    let signal: AbortSignal | null | undefined;
    jest.mocked(global.fetch).mockImplementationOnce(async (_url, init) => {
      signal = init?.signal;
      return {
        ok: true,
        json: () =>
          new Promise((resolve) => {
            resolveBody = resolve;
          }),
      } as Response;
    });
    const oldIntent = result.current.playbackIntentRef.current;
    result.current.handlePlaybackRecoveryExhausted('fatal');
    await waitFor(() => expect(resolveBody).toBeDefined());
    result.current.resetAutoSourceSwitch();
    expect(signal?.aborted).toBe(true);
    resolveBody(createLazySource('b', THREE_EPISODES));
    await Promise.resolve();
    await Promise.resolve();
    result.current.handleEpisodeUrlResolveFailed(oldIntent);
    expect(options.setCurrentSource).not.toHaveBeenCalled();
    expect(options.setAvailableSources).not.toHaveBeenCalled();
    expect(result.current.playbackIntentRef.current.attempts).toBe(0);
    expect(reportSourcePlayOutcome).toHaveBeenCalledTimes(1);
    expect(reportSourcePlayOutcome).toHaveBeenCalledWith('a', false);
  });

  it('中间失败源与成功候选各上报一次，候选独立获得预算', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const { result, options } = setupHook({
      availableSources: ['a', 'b'].map((key) =>
        createSource(key, THREE_EPISODES),
      ),
    });
    jest.spyOn(performance, 'now').mockReturnValue(59_750);
    result.current.handleEpisodeUrlResolveFailed();
    await waitFor(() => expect(options.currentSourceRef.current).toBe('b'));
    const intent = result.current.playbackIntentRef.current;
    expect(intent.activeSource?.startedAt).toBe(59_750);
    reportVodPlaybackOutcome(intent, 'b', true);
    reportVodPlaybackOutcome(intent, 'b', true);
    result.current.handlePlaybackRecoveryExhausted('fatal');
    expect(reportSourcePlayOutcome).toHaveBeenCalledTimes(2);
    expect(reportSourcePlayOutcome).toHaveBeenNthCalledWith(1, 'a', false);
    expect(reportSourcePlayOutcome).toHaveBeenNthCalledWith(2, 'b', true);
  });

  it('页面超时优先切到服务端代理，不急于换源', () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const video = document.createElement('video') as ManagedVideoElement;
    const switchToServerProxy = jest.fn(() => true);
    video.__icetvSwitchToServerProxy = switchToServerProxy;
    mockGetVodRuntimeSourceUrl.mockReturnValue('https://a.example/2.m3u8');

    const { result, options } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createSource('b', THREE_EPISODES),
      ],
      video,
      videoUrl: 'https://a.example/2.m3u8',
    });

    expect(result.current.handleLoadingTimeout()).toBe(true);
    expect(switchToServerProxy).toHaveBeenCalledWith('page-loading-timeout');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(options.onPlaybackStartFailed).not.toHaveBeenCalled();
  });

  it('播放器上的运行时不属于当前地址时不回退代理，按当前源超时处理', () => {
    const { video } = createLoadingVideo();
    const switchToServerProxy = jest.fn(() => true);
    video.__icetvSwitchToServerProxy = switchToServerProxy;
    mockGetVodRuntimeSourceUrl.mockReturnValue('https://a.example/1.m3u8');

    // 懒解析换集已清空地址，播放器上挂的仍是上一集的运行时
    const { result, options } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createSource('b', THREE_EPISODES),
      ],
      video,
    });
    expect(result.current.handleLoadingTimeout()).toBe(false);

    options.videoUrlRef.current = 'https://a.example/2.m3u8';
    expect(result.current.handleLoadingTimeout()).toBe(false);

    expect(switchToServerProxy).not.toHaveBeenCalled();
    expect(options.onPlaybackStartFailed).toHaveBeenCalledTimes(2);
    expect(options.setRealtimeLoadSpeed).toHaveBeenLastCalledWith(
      '当前源加载超时',
    );
  });

  it('同等健康度下优先切到直连源，较差的直连不越过中转', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    mockSelectionContext = {
      proxyModes: { relay: 'server' },
      healthTiers: { relay: 'good', direct: 'good', poor: 'poor' },
    };
    const { result, options } = setupHook({
      availableSources: ['a', 'poor', 'relay', 'direct'].map((key) =>
        createSource(key, THREE_EPISODES),
      ),
      videoInfo: new Map([
        ['poor-poor-id', info('9.0 MB/s')],
        ['relay-relay-id', info('9.0 MB/s')],
        ['direct-direct-id', info('200.0 KB/s')],
      ]),
    });

    expect(result.current.handleLoadingTimeout()).toBe(true);
    await waitFor(() =>
      expect(options.setCurrentSource).toHaveBeenCalledWith('direct'),
    );
    expect(fetchedDetailUrls()).toEqual([
      '/api/detail?source=direct&id=direct-id',
    ]);
  });

  it('开启后切到测速最快且有目标集的源', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const { result, options } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createSource('slow', THREE_EPISODES),
        createSource('short', ['第1集', '第2集']),
        createSource('fast', THREE_EPISODES),
      ],
      videoInfo: new Map([
        ['slow-slow-id', info('200.0 KB/s')],
        ['short-short-id', info('9.0 MB/s')],
        ['fast-fast-id', info('2.0 MB/s')],
      ]),
    });

    expect(result.current.handleLoadingTimeout()).toBe(true);

    await waitFor(() =>
      expect(options.setCurrentSource).toHaveBeenCalledWith('fast'),
    );
    expect(fetchedDetailUrls()).toEqual(['/api/detail?source=fast&id=fast-id']);
    expect(options.playbackRequestModeRef.current).toBe('auto-source');
    expect(options.setRealtimeLoadSpeed).toHaveBeenCalledWith(
      '正在尝试其他源...',
    );
    expect(options.setCurrentEpisodeIndex).toHaveBeenCalledWith(2);
  });

  it('同一意图内不回到失败源且最多换 3 次，手动换源后重新计数', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const { result, options } = setupHook({
      availableSources: ['a', 'b', 'c', 'd', 'e'].map((source) =>
        createSource(source, THREE_EPISODES),
      ),
    });

    for (const expected of ['b', 'c', 'd']) {
      expect(result.current.handleLoadingTimeout()).toBe(true);
      await waitFor(() =>
        expect(options.currentSourceRef.current).toBe(expected),
      );
    }

    expect(result.current.handleLoadingTimeout()).toBe(false);
    expect(options.setRealtimeLoadSpeed).toHaveBeenLastCalledWith(
      '当前源加载超时',
    );

    await result.current.handleSourceChange('e', 'e-id', '测试剧');
    expect(options.currentSourceRef.current).toBe('e');
    expect(options.playbackRequestModeRef.current).toBe('manual-source');

    expect(result.current.handleLoadingTimeout()).toBe(true);
    await waitFor(() => expect(options.currentSourceRef.current).toBe('a'));
  });

  it('完整详情缺目标集时跳过该源继续尝试下一个', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const { result, options } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createLazySource('b', THREE_EPISODES),
        createLazySource('c', THREE_EPISODES),
      ],
      fullDetails: { 'b-b-id': createSource('b', ['第1集', '第2集']) },
    });

    expect(result.current.handlePlaybackRecoveryExhausted('fatal')).toBe(true);

    await waitFor(() => expect(options.currentSourceRef.current).toBe('c'));
    expect(fetchedDetailUrls()).toEqual([
      '/api/detail?source=b&id=b-id',
      '/api/detail?source=c&id=c-id',
    ]);
    expect(options.setCurrentSource).not.toHaveBeenCalledWith('b');
    expect(options.setError).not.toHaveBeenCalledWith('当前源加载失败');
  });

  it('候选全部缺目标集时报告当前源失败', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const { result, options } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createLazySource('b', THREE_EPISODES),
      ],
      fullDetails: { 'b-b-id': createSource('b', ['第1集', '第2集']) },
    });

    expect(result.current.handlePlaybackRecoveryExhausted('fatal')).toBe(true);

    await waitFor(() =>
      expect(options.setError).toHaveBeenCalledWith('当前源加载失败'),
    );
    expect(options.setIsVideoLoading).toHaveBeenLastCalledWith(false);
    expect(options.playbackRequestModeRef.current).toBe('initial');
    expect(options.currentSourceRef.current).toBe('a');
  });

  it('自动换源优先选历史起播稳定的源', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      recordSourcePlaybackSuccess('slow', 1200);
    }
    const { result, options } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createSource('fast', THREE_EPISODES),
        createSource('slow', THREE_EPISODES),
      ],
      videoInfo: new Map([
        ['fast-fast-id', info('2.0 MB/s')],
        ['slow-slow-id', info('200.0 KB/s')],
      ]),
    });

    expect(result.current.handleLoadingTimeout()).toBe(true);

    await waitFor(() =>
      expect(options.setCurrentSource).toHaveBeenCalledWith('slow'),
    );
    expect(fetchedDetailUrls()).toEqual(['/api/detail?source=slow&id=slow-id']);
  });

  it('手动换到其他站点才计入手动选择，自动换源和同站点切换版本不计入', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const { result, options } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createSource('b', THREE_EPISODES),
        createSource('c', THREE_EPISODES),
        { ...createSource('c', THREE_EPISODES), id: 'c-variant' },
      ],
    });

    expect(result.current.handleLoadingTimeout()).toBe(true);
    await waitFor(() => expect(options.currentSourceRef.current).toBe('b'));
    expect(readSourcePlaybackStats().has('b')).toBe(false);

    await result.current.handleSourceChange('c', 'c-id', '测试剧');
    expect(options.currentSourceRef.current).toBe('c');
    expect(readSourcePlaybackStats().get('c')?.manualSelections).toBe(1);

    await result.current.handleSourceChange('c', 'c-variant', '测试剧');
    expect(options.currentIdRef.current).toBe('c-variant');
    expect(readSourcePlaybackStats().get('c')?.manualSelections).toBe(1);
    expect(readSourcePlaybackStats().has('b')).toBe(false);
  });

  it('手动换源立即停掉旧源，等待新源详情期间旧源的超时和失败不再换源或改动页面', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const { video, pause, runtimeCleanup, stopLoad } = createLoadingVideo();
    const { result, options } = setupHook({
      availableSources: createWaitingSources(['a', 'b', 'c']),
      video,
    });
    const releaseDetail = holdNextDetailFetch();

    const switching = result.current.handleSourceChange('b', 'b-id', '测试剧');
    expect(runtimeCleanup).toHaveBeenCalledTimes(1);
    expect(stopLoad).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalled();

    expect(result.current.handleLoadingTimeout()).toBe(true);
    expect(result.current.handlePlaybackRecoveryExhausted('fatal')).toBe(true);
    result.current.handleEpisodeUrlResolveFailed();
    expect(fetchedDetailUrls()).toEqual(['/api/detail?source=b&id=b-id']);
    expect(options.onPlaybackStartFailed).not.toHaveBeenCalled();
    expect(options.setRealtimeLoadSpeed).not.toHaveBeenCalledWith(
      '当前源加载超时',
    );
    expect(options.setRealtimeLoadSpeed).not.toHaveBeenCalledWith(
      '播放地址解析失败',
    );
    expect(options.setVideoLoadingAttempt).toHaveBeenCalledTimes(1);

    releaseDetail();
    await switching;
    expect(options.currentSourceRef.current).toBe('b');
    // 提交新源重新计时并解除进行中标记，之后的超时按新源处理
    expect(options.setVideoLoadingAttempt).toHaveBeenCalledTimes(2);
    expect(result.current.handleLoadingTimeout()).toBe(true);
    expect(options.onPlaybackStartFailed).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(options.currentSourceRef.current).toBe('a'));
  });

  it('手动换源等不到详情时，页面超时中止请求并按详情获取失败继续换源，不会一直停在切换中', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { video } = createLoadingVideo();
    const { result, options } = setupHook({
      availableSources: createWaitingSources(['a', 'b']),
      video,
    });
    const detailSignal = hangNextDetailFetch();

    const switching = result.current.handleSourceChange('b', 'b-id', '测试剧');
    expect(detailSignal()?.aborted).toBe(false);

    expect(result.current.handleLoadingTimeout()).toBe(true);
    expect(detailSignal()?.aborted).toBe(true);
    expect(options.onPlaybackStartFailed).not.toHaveBeenCalled();

    await switching;
    // 退回搜索结果里的详情提交新源，重新计时并解除进行中标记
    expect(options.currentSourceRef.current).toBe('b');
    expect(options.setVideoLoadingAttempt).toHaveBeenCalledTimes(2);
    expect(options.setError).not.toHaveBeenCalledWith(expect.any(String));
    expect(result.current.handleLoadingTimeout()).toBe(false);
    expect(options.onPlaybackStartFailed).toHaveBeenCalledTimes(1);
    expect(options.setRealtimeLoadSpeed).toHaveBeenLastCalledWith(
      '当前源加载超时',
    );
  });

  it('自动换源等不到详情时同样中止请求继续换源，之后的失败照常换下一个候选', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, options } = setupHook({
      availableSources: createWaitingSources(['a', 'b', 'c']),
    });
    const detailSignal = hangNextDetailFetch();

    expect(result.current.handleLoadingTimeout()).toBe(true);
    expect(fetchedDetailUrls()).toEqual(['/api/detail?source=b&id=b-id']);
    expect(result.current.handleLoadingTimeout()).toBe(true);
    expect(detailSignal()?.aborted).toBe(true);
    await waitFor(() => expect(options.currentSourceRef.current).toBe('b'));

    expect(result.current.handleLoadingTimeout()).toBe(true);
    await waitFor(() => expect(options.currentSourceRef.current).toBe('c'));
    expect(fetchedDetailUrls()).toEqual([
      '/api/detail?source=b&id=b-id',
      '/api/detail?source=c&id=c-id',
    ]);
    expect(options.onPlaybackStartFailed).toHaveBeenCalledTimes(2);
  });

  it('新的换源开始时中止上一次还在等待的详情请求，结果以新的换源为准', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { video } = createLoadingVideo();
    const { result, options } = setupHook({
      availableSources: createWaitingSources(['a', 'b', 'c']),
      video,
    });
    const firstDetailSignal = hangNextDetailFetch();

    const firstSwitch = result.current.handleSourceChange(
      'b',
      'b-id',
      '测试剧',
    );
    await result.current.handleSourceChange('c', 'c-id', '测试剧');
    expect(firstDetailSignal()?.aborted).toBe(true);
    await firstSwitch;

    expect(options.currentSourceRef.current).toBe('c');
    expect(options.setCurrentSource).not.toHaveBeenCalledWith('b');
    expect(consoleError).not.toHaveBeenCalled();
    expect(result.current.handleLoadingTimeout()).toBe(false);
  });

  it('自动换源进行中再次失败不重复发起，已发起的目标不会再被选中', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const { result, options } = setupHook({
      availableSources: createWaitingSources(['a', 'b', 'c']),
    });
    const releaseDetail = holdNextDetailFetch();

    expect(result.current.handleLoadingTimeout()).toBe(true);
    expect(result.current.handlePlaybackRecoveryExhausted('fatal')).toBe(true);
    expect(result.current.handleLoadingTimeout()).toBe(true);
    expect(fetchedDetailUrls()).toEqual(['/api/detail?source=b&id=b-id']);
    expect(options.onPlaybackStartFailed).toHaveBeenCalledTimes(1);

    releaseDetail();
    await waitFor(() => expect(options.currentSourceRef.current).toBe('b'));

    expect(result.current.handlePlaybackRecoveryExhausted('fatal')).toBe(true);
    await waitFor(() => expect(options.currentSourceRef.current).toBe('c'));
    expect(fetchedDetailUrls()).toEqual([
      '/api/detail?source=b&id=b-id',
      '/api/detail?source=c&id=c-id',
    ]);
  });

  it('自动换源没能提交就异常结束时，下一次自动换源不再选同一目标', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const { result, options } = setupHook({
      availableSources: createWaitingSources(['a', 'b', 'c']),
    });
    (options.setCurrentSource as jest.Mock).mockImplementationOnce(() => {
      throw new Error('提交新源失败');
    });

    expect(result.current.handlePlaybackRecoveryExhausted('fatal')).toBe(true);
    await waitFor(() =>
      expect(options.setError).toHaveBeenCalledWith('提交新源失败'),
    );
    expect(options.currentSourceRef.current).toBe('a');

    expect(result.current.handlePlaybackRecoveryExhausted('fatal')).toBe(true);
    await waitFor(() => expect(options.currentSourceRef.current).toBe('c'));
    expect(fetchedDetailUrls()).toEqual([
      '/api/detail?source=b&id=b-id',
      '/api/detail?source=c&id=c-id',
    ]);
  });

  it('手动换到缺目标集的源时按原进度重载当前源，重新起播后再提示', async () => {
    const { video } = createLoadingVideo();
    const { result, options, player } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createLazySource('b', THREE_EPISODES),
      ],
      fullDetails: { 'b-b-id': createSource('b', ['第1集', '第2集']) },
      video,
      playerCurrentTime: 200,
    });

    await result.current.handleSourceChange('b', 'b-id', '测试剧');

    expect(options.setCurrentSource).not.toHaveBeenCalled();
    expect(options.resumeTimeRef.current).toBe(200);
    expect(options.resumeModeRef.current).toBe('forced');
    expect(options.setPlaybackRetryNonce).toHaveBeenCalledTimes(1);
    expect(options.setIsVideoLoading).toHaveBeenLastCalledWith(true);
    expect(options.setSourceSearchError).not.toHaveBeenCalled();
    expect(player?.notice.show).toBe('');

    result.current.showPendingPlaybackNotice();
    expect(player?.notice.show).toBe('该源没有第 3 集，已保留当前播放');

    // 提示只显示一次，之后的起播不再重复
    if (player) player.notice.show = '';
    result.current.showPendingPlaybackNotice();
    expect(player?.notice.show).toBe('');
  });
});

describe('useSourceSwitch 重新拉起当前源', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('已起播时按播放器当前进度强制续播，不清进度标记也不动稳定进度', () => {
    const { video } = createLoadingVideo();
    const { result, options } = setupHook({
      availableSources: [createSource('a', THREE_EPISODES)],
      video,
      playerCurrentTime: 125,
    });
    options.stableCurrentTimeRef.current = 120;
    options.resumeModeRef.current = 'history';

    result.current.restartCurrentPlayback();

    expect(options.resumeTimeRef.current).toBe(125);
    expect(options.resumeModeRef.current).toBe('forced');
    expect(options.clearTargetEpisodeProgressRef.current).toBe(false);
    expect(options.stableCurrentTimeRef.current).toBe(120);
    expect(options.setError).toHaveBeenCalledWith(null);
    expect(options.setIsVideoLoading).toHaveBeenLastCalledWith(true);
    expect(options.setVideoLoadingAttempt).toHaveBeenCalledTimes(1);
    expect(options.setPlaybackRetryNonce).toHaveBeenCalledTimes(1);
  });

  it('播放器已销毁时退回最近的稳定进度', () => {
    const { result, options } = setupHook({
      availableSources: [createSource('a', THREE_EPISODES)],
    });
    options.stableCurrentTimeRef.current = 80;

    result.current.restartCurrentPlayback();

    expect(options.resumeTimeRef.current).toBe(80);
    expect(options.resumeModeRef.current).toBe('forced');
  });

  it('目标集尚未起播时沿用原恢复点，不取上一集留在播放器上的时间', () => {
    const { video } = createLoadingVideo();
    const { result, options } = setupHook({
      availableSources: [createSource('a', THREE_EPISODES)],
      video,
      playerCurrentTime: 900,
    });
    options.clearTargetEpisodeProgressRef.current = true;
    options.resumeTimeRef.current = 300;
    options.resumeModeRef.current = 'forced';

    result.current.restartCurrentPlayback();
    expect(options.resumeTimeRef.current).toBe(300);
    expect(options.resumeModeRef.current).toBe('forced');
    expect(options.clearTargetEpisodeProgressRef.current).toBe(true);

    // 从头播放的目标集重试后仍从头播放
    options.resumeTimeRef.current = 0;
    options.resumeModeRef.current = null;
    result.current.restartCurrentPlayback();
    expect(options.resumeTimeRef.current).toBe(0);
    expect(options.resumeModeRef.current).toBeNull();
    expect(options.setPlaybackRetryNonce).toHaveBeenCalledTimes(2);
  });
});

describe('useSourceSwitch 提交新源后的页面同步', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    mockGetVodRuntimeSourceUrl.mockReset();
    mockGetVodRuntimeSourceUrl.mockReturnValue(null);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.history.replaceState(
      { marker: 'next-router-state' },
      '',
      '/play?source=a&id=a-id&title=%E6%B5%8B%E8%AF%95%E5%89%A7&year=2024&stitle=%E6%B5%8B%E8%AF%95&prefer=true',
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('地址栏改为新源，保留搜索参数，去掉起播专用参数，不沿用旧路由状态', async () => {
    const { result } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        { ...createSource('b', THREE_EPISODES), title: '测试剧 国语' },
      ],
    });

    await result.current.handleSourceChange('b', 'b-id', '测试剧 国语');

    const params = new URLSearchParams(window.location.search);
    expect(window.location.pathname).toBe('/play');
    expect(params.get('source')).toBe('b');
    expect(params.get('id')).toBe('b-id');
    expect(params.get('title')).toBe('测试剧 国语');
    expect(params.get('year')).toBe('2024');
    expect(params.get('stitle')).toBe('测试');
    expect(params.has('prefer')).toBe(false);
    // 带着旧路由状态时 Next 不同步新地址，之后的路由更新会把地址改回旧源
    expect(window.history.state).toBeNull();
  });

  it('自动换源同样同步地址，拒绝换源时地址保持当前源', async () => {
    localStorage.setItem(AUTO_SWITCH_SOURCE_STORAGE_KEY, 'true');
    const { result, options } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createSource('b', THREE_EPISODES),
        createSource('short', ['第1集']),
      ],
    });

    await result.current.handleSourceChange('short', 'short-id', '测试剧');
    expect(options.setCurrentSource).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get('source')).toBe('a');

    expect(result.current.handleLoadingTimeout()).toBe(true);
    await waitFor(() => expect(options.currentSourceRef.current).toBe('b'));
    expect(new URLSearchParams(window.location.search).get('id')).toBe('b-id');
  });

  it('换源的程序性暂停不留下 Artplayer 的暂停提示', async () => {
    const { video } = createLoadingVideo();
    const { result, player } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createSource('b', THREE_EPISODES),
      ],
      video,
    });
    // 与 Artplayer 的 pause() 一致：暂停时同步弹出提示
    player?.pause.mockImplementation(() => {
      player.notice.show = '暂停';
    });

    await result.current.handleSourceChange('b', 'b-id', '测试剧');

    expect(player?.pause).toHaveBeenCalled();
    expect(player?.notice.show).toBe('');
  });

  it('换到同一集的其他源时沿用已匹配的弹幕剧集，目标源已有映射时不覆盖', async () => {
    writeDanmakuEpisodeId('a:a-id:2', 4242);
    writeDanmakuEpisodeSearchTitle('a:a-id:2', '测试剧 第二季');
    writeDanmakuEpisodeId('c:c-id:2', 777);
    const { result } = setupHook({
      availableSources: ['a', 'b', 'c'].map((source) =>
        createSource(source, THREE_EPISODES),
      ),
    });

    await result.current.handleSourceChange('b', 'b-id', '测试剧');
    expect(readDanmakuEpisodeId('b:b-id:2')).toBe(4242);
    expect(readDanmakuEpisodeSearchTitle('b:b-id:2')).toBe('测试剧 第二季');

    await result.current.handleSourceChange('c', 'c-id', '测试剧');
    expect(readDanmakuEpisodeId('c:c-id:2')).toBe(777);
  });

  it('新源对应的不是同一集时不沿用弹幕剧集', async () => {
    writeDanmakuEpisodeId('a:a-id:2', 4242);
    const { result, options } = setupHook({
      availableSources: [
        createSource('a', THREE_EPISODES),
        createSource('b', ['第1集', '第2集', '第5集']),
      ],
    });
    options.clearTargetEpisodeProgressRef.current = true;

    await result.current.handleSourceChange('b', 'b-id', '测试剧');
    expect(options.setCurrentSource).toHaveBeenCalledWith('b');
    expect(options.setCurrentEpisodeIndex).toHaveBeenCalledWith(2);
    expect(readDanmakuEpisodeId('b:b-id:2')).toBeNull();
  });
});

describe('useSourceSwitch 候选可直接起播时详情改为后台刷新', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function appliedDetail(
    options: ReturnType<typeof setupHook>['options'],
  ): SearchResult | null {
    const update = (options.setDetail as jest.Mock).mock.calls.at(-1)?.[0];
    return typeof update === 'function'
      ? update(options.detailRef.current)
      : update;
  }

  it('候选已能确认同一集时不等详情直接提交新源', async () => {
    const { result, options } = setupHook({
      availableSources: ['a', 'b'].map((key) =>
        createSource(key, THREE_EPISODES),
      ),
    });
    const releaseDetail = holdNextDetailFetch();
    jest.mocked(holdBackgroundSourceProbes).mockClear();

    await result.current.handleSourceChange('b', 'b-id', '测试剧');

    expect(holdBackgroundSourceProbes).toHaveBeenCalledTimes(1);
    expect(options.currentSourceRef.current).toBe('b');
    expect(options.setCurrentEpisodeIndex).toHaveBeenCalledWith(2);
    expect(fetchedDetailUrls()).toEqual(['/api/detail?source=b&id=b-id']);

    releaseDetail();
    await Promise.resolve();
    await Promise.resolve();
    // 详情与候选一致时不再改动页面
    expect(options.setDetail).toHaveBeenCalledTimes(1);
    expect(options.setCurrentEpisodeIndex).toHaveBeenCalledTimes(1);
  });

  it('后台详情的当前集地址变化时换成新详情', async () => {
    const refreshed = createSource('b', THREE_EPISODES);
    refreshed.episodes[2] = 'https://b.example/new-2.m3u8';
    const { result, options } = setupHook({
      availableSources: ['a', 'b'].map((key) =>
        createSource(key, THREE_EPISODES),
      ),
      fullDetails: { 'b-b-id': refreshed },
    });

    await result.current.handleSourceChange('b', 'b-id', '测试剧');

    await waitFor(() => expect(options.setDetail).toHaveBeenCalledTimes(2));
    expect(appliedDetail(options)?.episodes[2]).toBe(
      'https://b.example/new-2.m3u8',
    );
    expect(options.setCurrentEpisodeIndex).toHaveBeenLastCalledWith(2);
    expect(options.setAvailableSources).toHaveBeenCalled();
  });

  it('后台详情缺当前集时保留已提交的候选，不在起播中途跳集', async () => {
    const { result, options } = setupHook({
      availableSources: ['a', 'b'].map((key) =>
        createSource(key, THREE_EPISODES),
      ),
      fullDetails: { 'b-b-id': createSource('b', ['第1集', '第2集']) },
    });

    await result.current.handleSourceChange('b', 'b-id', '测试剧');
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();

    expect(options.currentSourceRef.current).toBe('b');
    expect(options.setDetail).toHaveBeenCalledTimes(1);
    expect(options.setCurrentEpisodeIndex).toHaveBeenCalledTimes(1);
  });

  it('新的播放意图中止后台详情刷新', async () => {
    const { result } = setupHook({
      availableSources: ['a', 'b'].map((key) =>
        createSource(key, THREE_EPISODES),
      ),
    });
    const detailSignal = hangNextDetailFetch();

    await result.current.handleSourceChange('b', 'b-id', '测试剧');
    expect(detailSignal()?.aborted).toBe(false);

    result.current.resetAutoSourceSwitch();
    expect(detailSignal()?.aborted).toBe(true);
  });
});
