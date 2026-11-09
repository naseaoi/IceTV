import type { PlaybackRequestMode } from '@/features/play/hooks/usePlayPageState';
import { PLAYBACK_STALL_CONFIRMATION_DELAY_MS } from '@/features/play/lib/playbackStallRecovery';
import { getVodStartupProgress } from '@/features/play/lib/playerLoading';
import {
  createVodM3u8Loader,
  getVodRuntimeSourceUrl,
  pauseIfVodRuntimeReleased,
  registerVodNativeRuntime,
} from '@/features/play/lib/vodHlsRuntime';
import { createVodPlaybackIntent } from '@/features/play/lib/vodPlaybackIntent';
import { buildVodProxyUrl } from '@/features/play/lib/vodProxyUrl';
import { getManagedVideo, runManagedVideoCleanup } from '@/lib/player-runtime';
import {
  HLS_FATAL_MEDIA_RECOVERY_LIMIT,
  HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS,
} from '@/lib/player-utils';
import type { SearchResult } from '@/lib/types';

const mockIsServerProxy = jest.fn<boolean, [string, string | undefined]>();
const mockShouldAutoFallbackToServer = jest.fn<boolean, [string]>();
const mockClearSourceProxyOverride = jest.fn();
const mockReportSourceRouteStat = jest.fn();

jest.mock('@/lib/proxy-modes', () => ({
  clearSourceProxyOverride: (...args: unknown[]) =>
    mockClearSourceProxyOverride(...args),
  getSourcePlaybackRoute: (sourceKey: string, rawUrl?: string) => ({
    useServerProxy: mockIsServerProxy(sourceKey, rawUrl),
    directManifest: false,
    allowAutoFallback: mockShouldAutoFallbackToServer(sourceKey),
  }),
  rememberSourceServerProxy: jest.fn(),
  shouldAutoFallbackToServer: (sourceKey: string) =>
    mockShouldAutoFallbackToServer(sourceKey),
}));

jest.mock('@/lib/source-route-stats.client', () => ({
  reportSourceRouteStat: (...args: unknown[]) =>
    mockReportSourceRouteStat(...args),
}));

type LoaderOptions = Parameters<typeof createVodM3u8Loader>[0];
type HlsListener = (event: string, data: unknown) => void;

class FakeLoader {
  load = jest.fn();
}

class FakeHls {
  static Events = {
    ERROR: 'hlsError',
    FRAG_LOADED: 'hlsFragLoaded',
    FRAG_LOADING: 'hlsFragLoading',
    FRAG_BUFFERED: 'hlsFragBuffered',
    LEVEL_LOADED: 'hlsLevelLoaded',
    MANIFEST_PARSED: 'hlsManifestParsed',
  };

  static ErrorTypes = {
    NETWORK_ERROR: 'networkError',
    MEDIA_ERROR: 'mediaError',
    OTHER_ERROR: 'otherError',
  };

  static ErrorDetails = {
    BUFFER_FULL_ERROR: 'bufferFullError',
  };

  static DefaultConfig = { loader: FakeLoader };

  static created = 0;

  config: Record<string, unknown>;
  levels: unknown[] = [];
  loadingEnabled = true;
  inFlightFragments: Record<string, { frag: unknown; state: string }> = {
    main: { frag: null, state: 'IDLE' },
  };
  loadSource = jest.fn();
  attachMedia = jest.fn();
  startLoad = jest.fn();
  stopLoad = jest.fn();
  destroy = jest.fn();
  recoverMediaError = jest.fn();
  swapAudioCodec = jest.fn();
  private readonly listeners = new Map<string, Set<HlsListener>>();

  constructor(config: Record<string, unknown>) {
    this.config = { ...config };
    FakeHls.created += 1;
  }

  on(event: string, listener: HlsListener) {
    const listeners = this.listeners.get(event) ?? new Set<HlsListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: HlsListener) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, data: unknown) {
    [...(this.listeners.get(event) ?? [])].forEach((listener) =>
      listener(event, data),
    );
  }
}

const EPISODE_1 = 'https://cdn.example/ep1/index.m3u8';
const EPISODE_2 = 'https://cdn.example/ep2/index.m3u8';

const DETAIL: SearchResult = {
  id: 'demo-id',
  title: '测试剧',
  poster: '',
  episodes: [EPISODE_1, EPISODE_2],
  episodes_titles: ['第1集', '第2集'],
  source: 'demo',
  source_name: 'Demo',
  year: '2024',
};

const NON_FATAL_FRAG_ERROR = {
  type: FakeHls.ErrorTypes.NETWORK_ERROR,
  details: 'fragLoadError',
  fatal: false,
  response: { code: 404 },
};

const FATAL_MANIFEST_ERROR = {
  type: FakeHls.ErrorTypes.NETWORK_ERROR,
  details: 'manifestLoadError',
  fatal: true,
  response: { code: 404 },
};

const FRAG_LOADED = {
  frag: {
    level: 0,
    url: 'https://cdn.example/ep1/seg-1.ts',
    stats: { loaded: 1024, total: 1024, loading: { first: 0, end: 100 } },
  },
};

function mainFragment(sn: number) {
  return {
    sn,
    type: 'main',
    level: 0,
    url: `https://cdn.example/ep1/seg-${sn}.ts`,
    stats: { loaded: 1024, total: 1024, loading: { first: 0, end: 100 } },
  };
}

function fatalFragError(sn: number) {
  return {
    type: FakeHls.ErrorTypes.NETWORK_ERROR,
    details: 'fragLoadError',
    fatal: true,
    frag: mainFragment(sn),
    response: { code: 0 },
  };
}

const NATIVE_URL = 'https://cdn.example/movie.mp4';

const createdVideos: HTMLVideoElement[] = [];

function createVideo() {
  const video = document.createElement('video');
  video.pause = jest.fn();
  createdVideos.push(video);
  return video;
}

function getFakeHls(video: HTMLVideoElement) {
  return getManagedVideo(video).hls as unknown as FakeHls;
}

function setupRuntime() {
  const setError = jest.fn();
  const setIsVideoLoading = jest.fn();
  const setRealtimeLoadSpeed = jest.fn();
  const onPlaybackRecoveryExhausted = jest.fn<boolean, [string]>(() => false);
  const options: LoaderOptions = {
    Hls: FakeHls,
    adBlockingHlsLoader: FakeLoader,
    artPlayerRef: { current: null },
    blockAdEnabledRef: { current: false },
    detailRef: { current: DETAIL },
    playbackInfoContext: {
      source: DETAIL.source,
      id: DETAIL.id,
      videoUrl: EPISODE_1,
    },
    playbackRequestModeRef: { current: 'episode' as PlaybackRequestMode },
    resumeTimeRef: { current: null },
    resumeModeRef: { current: null },
    allowAutoResumeRef: { current: true },
    stableCurrentTimeRef: { current: 0 },
    loadingSessionRef: {
      current: {
        pendingInitialResumeTarget: null,
        playbackStartNotified: false,
      },
    },
    setError,
    setIsVideoLoading,
    setRealtimeLoadSpeed,
    onSourceProxyFallbackStarted: jest.fn(),
    onPlaybackRecoveryExhausted,
  };
  return {
    options,
    load: createVodM3u8Loader(options),
    setError,
    setIsVideoLoading,
    setRealtimeLoadSpeed,
    onPlaybackRecoveryExhausted,
  };
}

describe('vodHlsRuntime 运行时释放', () => {
  beforeEach(() => {
    FakeHls.created = 0;
    mockIsServerProxy.mockReset().mockReturnValue(false);
    mockShouldAutoFallbackToServer.mockReset().mockReturnValue(true);
    jest.requireMock('@/lib/proxy-modes').rememberSourceServerProxy.mockClear();
    mockClearSourceProxyOverride.mockReset();
    mockReportSourceRouteStat.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createdVideos.splice(0).forEach((video) => runManagedVideoCleanup(video));
    jest.restoreAllMocks();
  });

  it('续播目标在拉清单前写入 HLS，复用换集重设目标且不额外 startLoad', () => {
    const { load, options } = setupRuntime();
    options.resumeTimeRef.current = 1064;
    options.resumeModeRef.current = 'history';
    const video = createVideo();
    load(video, EPISODE_1);
    const hls = getFakeHls(video);
    expect(hls.config.startPosition).toBe(1064);
    hls.loadSource.mockImplementation(() => {
      expect(hls.config.startPosition).toBe(0);
    });
    options.resumeTimeRef.current = null;
    options.resumeModeRef.current = 'forced';
    load(video, EPISODE_2);
    expect(getFakeHls(video)).toBe(hls);
    expect(hls.config.startPosition).toBe(0);
    expect(hls.startLoad).not.toHaveBeenCalled();
  });

  it('禁用历史恢复时不采用历史目标，强制恢复仍采用目标', () => {
    const { load, options } = setupRuntime();
    options.resumeTimeRef.current = 500;
    options.resumeModeRef.current = 'history';
    options.allowAutoResumeRef.current = false;
    const video = createVideo();
    load(video, EPISODE_1);
    expect(getFakeHls(video).config.startPosition).toBe(0);
    options.resumeModeRef.current = 'forced';
    load(video, EPISODE_2);
    expect(getFakeHls(video).config.startPosition).toBe(500);
  });

  it('字节增长和清单完成续期，重复采样与释放后迟到事件不续期', () => {
    let now = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    const { load } = setupRuntime();
    const video = createVideo();
    load(video, EPISODE_1);
    const hls = getFakeHls(video);
    const progress = getVodStartupProgress(video)!;
    expect(progress.startedAt).toBe(0);
    now = 1000;
    hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: [] });
    expect(progress.lastProgressAt).toBe(1000);
    const frag = { stats: { loaded: 1 } };
    hls.inFlightFragments.main = { frag, state: 'FRAG_LOADING' };
    now = 2000;
    expect(getVodStartupProgress(video)?.lastProgressAt).toBe(2000);
    now = 3000;
    expect(getVodStartupProgress(video)?.lastProgressAt).toBe(2000);
    frag.stats.loaded = 50;
    expect(getVodStartupProgress(video)?.lastProgressAt).toBe(3000);
    now = 4000;
    hls.emit(FakeHls.Events.FRAG_LOADED, FRAG_LOADED);
    expect(progress.lastProgressAt).toBe(4000);
    runManagedVideoCleanup(video);
    now = 5000;
    hls.emit(FakeHls.Events.FRAG_LOADED, FRAG_LOADED);
    expect(progress.lastProgressAt).toBe(4000);
    expect(getVodStartupProgress(video)).toBeNull();
  });

  it('服务端回落共用总预算并保留续播初始加载位置', () => {
    let now = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    const { load, options } = setupRuntime();
    options.resumeTimeRef.current = 1064;
    options.resumeModeRef.current = 'history';
    const video = createVideo();
    load(video, EPISODE_1);
    const first = getVodStartupProgress(video);
    now = 15_000;
    expect(getManagedVideo(video).__icetvSwitchToServerProxy?.('timeout')).toBe(
      true,
    );
    expect(getVodStartupProgress(video)).not.toBe(first);
    expect(getVodStartupProgress(video)?.startedAt).toBe(first?.startedAt);
    expect(getFakeHls(video).config.startPosition).toBe(1064);
    expect(getFakeHls(video).startLoad).not.toHaveBeenCalled();
  });

  it('播放中 HLS 回落进入页面加载等待并以新的恢复起点计时', () => {
    const { options, setIsVideoLoading } = setupRuntime();
    options.playbackIntentRef = { current: createVodPlaybackIntent() };
    const now = jest.spyOn(performance, 'now').mockReturnValue(0);
    const video = createVideo();
    createVodM3u8Loader(options)(video, EPISODE_1);
    video.dispatchEvent(new Event('playing'));
    now.mockReturnValue(300_000);
    getFakeHls(video).emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);
    expect(setIsVideoLoading).toHaveBeenLastCalledWith(true);
    expect(options.onSourceProxyFallbackStarted).toHaveBeenCalledTimes(1);
    expect(getVodStartupProgress(video)?.startedAt).toBe(300_000);
    video.dispatchEvent(new Event('playing'));
    expect(
      options.playbackIntentRef.current.activeSource?.startedAt,
    ).toBeNull();
  });

  it('原生运行时重新登记时释放旧回落入口与进度监听', () => {
    const video = createVideo();
    registerVodNativeRuntime(video, NATIVE_URL);
    const oldProgress = getVodStartupProgress(video)!;
    getManagedVideo(video).__icetvSwitchToServerProxy = jest.fn(() => true);
    registerVodNativeRuntime(video, `${NATIVE_URL}?next=1`);
    expect(getManagedVideo(video).__icetvSwitchToServerProxy).toBeNull();
    const now = jest.spyOn(performance, 'now').mockReturnValue(300_000);
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(oldProgress.lastProgressAt).not.toBe(300_000);
    expect(getVodStartupProgress(video)?.lastProgressAt).toBe(300_000);
    now.mockRestore();
  });

  it('成功播放后换源开启恢复预算，保留原意图尝试集合', () => {
    const { options } = setupRuntime();
    options.playbackIntentRef = { current: createVodPlaybackIntent() };
    const load = createVodM3u8Loader(options);
    const now = jest.spyOn(performance, 'now').mockReturnValue(0);
    const video = createVideo();
    load(video, EPISODE_1);
    now.mockReturnValue(300_000);
    video.dispatchEvent(new Event('playing'));
    load(video, EPISODE_2);
    expect(getVodStartupProgress(video)?.startedAt).toBe(300_000);
    expect(
      options.playbackIntentRef.current.activeSource?.triedRoutes.size,
    ).toBe(1);
  });

  it('A 两路失败后 B 仍可直连回落代理，回落不占换源名额', () => {
    const { options, onPlaybackRecoveryExhausted } = setupRuntime();
    options.playbackIntentRef = { current: createVodPlaybackIntent() };
    const video = createVideo();
    createVodM3u8Loader(options)(video, EPISODE_1);
    const hls = getFakeHls(video);
    hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);
    expect(options.playbackIntentRef.current.attempts).toBe(0);
    hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);
    expect(onPlaybackRecoveryExhausted).toHaveBeenCalledTimes(1);
    options.detailRef.current = { ...DETAIL, source: 'b', id: 'b-id' };
    options.playbackIntentRef.current.attempts = 3;
    const now = jest.spyOn(performance, 'now').mockReturnValue(59_750);
    createVodM3u8Loader(options)(video, EPISODE_2);
    expect(getVodStartupProgress(video)?.startedAt).toBe(59_750);
    now.mockReturnValue(60_000);
    getFakeHls(video).emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);
    expect(getManagedVideo(video).__icetvUsingServerProxy).toBe(true);
    expect(options.playbackIntentRef.current.attempts).toBe(3);
    expect(
      options.playbackIntentRef.current.activeSource?.triedRoutes.size,
    ).toBe(2);
    video.dispatchEvent(new Event('playing'));
    expect(
      options.playbackIntentRef.current.activeSource?.startedAt,
    ).toBeNull();
  });

  it('加载后登记运行时对应的地址，释放后清除登记和服务端回退入口', () => {
    const { load } = setupRuntime();
    const video = createVideo();

    load(video, EPISODE_1);
    expect(getVodRuntimeSourceUrl(video)).toBe(EPISODE_1);
    expect(getManagedVideo(video).__icetvSwitchToServerProxy).toEqual(
      expect.any(Function),
    );

    runManagedVideoCleanup(video);
    expect(getVodRuntimeSourceUrl(video)).toBeNull();
    expect(getManagedVideo(video).__icetvSwitchToServerProxy).toBeNull();
  });

  it('释放后下一集仍复用同一个 hls 实例加载，登记切到新地址', () => {
    const { load } = setupRuntime();
    const video = createVideo();
    load(video, EPISODE_1);
    const hls = getFakeHls(video);

    hls.stopLoad();
    runManagedVideoCleanup(video);
    load(video, EPISODE_2);

    expect(FakeHls.created).toBe(1);
    expect(getFakeHls(video)).toBe(hls);
    expect(hls.attachMedia).toHaveBeenCalledTimes(1);
    expect(hls.destroy).not.toHaveBeenCalled();
    expect(hls.loadSource).toHaveBeenLastCalledWith(
      buildVodProxyUrl({
        rawUrl: EPISODE_2,
        useServerProxy: false,
        directManifest: true,
        sourceKey: DETAIL.source,
        playbackRequestMode: 'episode',
      }),
    );
    expect(getVodRuntimeSourceUrl(video)).toBe(EPISODE_2);
    expect(getManagedVideo(video).__icetvSwitchToServerProxy).toEqual(
      expect.any(Function),
    );
  });

  it('运行时未释放时分片加载完成会刷新速度并上报当前线路成功', () => {
    const runtime = setupRuntime();
    const video = createVideo();
    runtime.load(video, EPISODE_1);
    runtime.setRealtimeLoadSpeed.mockClear();

    getFakeHls(video).emit(FakeHls.Events.FRAG_LOADED, FRAG_LOADED);

    expect(runtime.setRealtimeLoadSpeed).toHaveBeenCalledWith(
      expect.stringMatching(/\/s$/),
    );
    expect(mockReportSourceRouteStat).toHaveBeenCalledWith(
      DETAIL.source,
      'browser',
      true,
    );
  });

  it('已释放的运行时收到复用实例上迟到的分片和清单事件时不刷新速度也不上报线路', () => {
    const runtime = setupRuntime();
    const video = createVideo();
    runtime.load(video, EPISODE_1);
    const hls = getFakeHls(video);
    runManagedVideoCleanup(video);
    runtime.setRealtimeLoadSpeed.mockClear();

    hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: [] });
    hls.emit(FakeHls.Events.LEVEL_LOADED, {
      level: 0,
      details: { fragments: [] },
    });
    hls.emit(FakeHls.Events.FRAG_LOADING, { frag: { level: 0 } });
    hls.emit(FakeHls.Events.FRAG_LOADED, FRAG_LOADED);
    hls.emit(FakeHls.Events.FRAG_BUFFERED, {});

    expect(runtime.setRealtimeLoadSpeed).not.toHaveBeenCalled();
    expect(mockReportSourceRouteStat).not.toHaveBeenCalled();
  });

  it('hls 运行时释放后按已释放处理：暂停视频，未释放时不干预', () => {
    const { load } = setupRuntime();
    const video = createVideo();
    const pause = jest.fn();
    video.pause = pause;
    load(video, EPISODE_1);

    expect(pauseIfVodRuntimeReleased(video)).toBe(false);
    expect(pause).not.toHaveBeenCalled();

    runManagedVideoCleanup(video);
    expect(pauseIfVodRuntimeReleased(video)).toBe(true);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('原生播放登记本次加载的地址，停旧源释放后同样按已释放处理', () => {
    const video = createVideo();
    const pause = jest.fn();
    video.pause = pause;

    expect(pauseIfVodRuntimeReleased(video)).toBe(true);
    pause.mockClear();

    registerVodNativeRuntime(video, NATIVE_URL);
    expect(getVodRuntimeSourceUrl(video)).toBe(NATIVE_URL);
    expect(pauseIfVodRuntimeReleased(video)).toBe(false);
    expect(pause).not.toHaveBeenCalled();

    runManagedVideoCleanup(video);
    expect(getVodRuntimeSourceUrl(video)).toBeNull();
    expect(pauseIfVodRuntimeReleased(video)).toBe(true);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  describe('服务端路线的加载失败', () => {
    beforeEach(() => {
      mockIsServerProxy.mockReturnValue(true);
      mockShouldAutoFallbackToServer.mockReturnValue(false);
    });

    it('运行时未释放时交给外层处理并展示当前源失败', () => {
      const runtime = setupRuntime();
      const video = createVideo();
      runtime.load(video, EPISODE_1);
      const hls = getFakeHls(video);

      hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);

      expect(hls.stopLoad).toHaveBeenCalledTimes(1);
      expect(runtime.onPlaybackRecoveryExhausted).toHaveBeenCalledWith(
        'networkError:manifestLoadError',
      );
      expect(runtime.setError).toHaveBeenCalledWith('当前源加载失败');
      expect(mockReportSourceRouteStat).toHaveBeenCalledWith(
        DETAIL.source,
        'server',
        false,
      );
    });

    it.each([EPISODE_1, EPISODE_2])(
      '失败后保留实例，重新加载 %s 时恢复运行时',
      (retryUrl) => {
        const runtime = setupRuntime();
        const video = createVideo();
        runtime.load(video, EPISODE_1);
        const hls = getFakeHls(video);
        hls.stopLoad.mockImplementation(() => {
          expect(getVodRuntimeSourceUrl(video)).toBeNull();
        });

        hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);

        expect(getManagedVideo(video).__icetvHlsCleanup).toBeNull();
        expect(getManagedVideo(video).__icetvSwitchToServerProxy).toBeNull();
        expect(getVodStartupProgress(video)).toBeNull();
        expect(video.pause).toHaveBeenCalledTimes(1);
        expect(pauseIfVodRuntimeReleased(video)).toBe(true);
        expect(runtime.setIsVideoLoading).toHaveBeenLastCalledWith(false);
        expect(runtime.setRealtimeLoadSpeed).toHaveBeenLastCalledWith('');
        expect(hls.destroy).not.toHaveBeenCalled();
        runtime.setRealtimeLoadSpeed.mockClear();
        mockReportSourceRouteStat.mockClear();
        hls.emit(FakeHls.Events.FRAG_LOADED, FRAG_LOADED);
        expect(runtime.setRealtimeLoadSpeed).not.toHaveBeenCalled();
        expect(mockReportSourceRouteStat).not.toHaveBeenCalled();

        runtime.load(video, retryUrl);

        expect(getFakeHls(video)).toBe(hls);
        expect(getVodRuntimeSourceUrl(video)).toBe(retryUrl);
        expect(pauseIfVodRuntimeReleased(video)).toBe(false);
        expect(hls.loadSource).toHaveBeenCalledTimes(2);
        hls.emit(FakeHls.Events.FRAG_LOADED, FRAG_LOADED);
        expect(mockReportSourceRouteStat).toHaveBeenCalledWith(
          DETAIL.source,
          'server',
          true,
        );
      },
    );

    it('外层接手后由换源流程清理，保留其新建的运行时且不展示旧源失败', () => {
      const runtime = setupRuntime();
      const video = createVideo();
      runtime.load(video, EPISODE_1);
      const hls = getFakeHls(video);
      runtime.onPlaybackRecoveryExhausted.mockImplementation(() => {
        expect(getVodRuntimeSourceUrl(video)).toBe(EPISODE_1);
        expect(hls.stopLoad).not.toHaveBeenCalled();
        runManagedVideoCleanup(video);
        hls.stopLoad();
        video.pause();
        runtime.load(video, EPISODE_2);
        return true;
      });

      hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);

      expect(runtime.onPlaybackRecoveryExhausted).toHaveBeenCalledTimes(1);
      expect(hls.stopLoad).toHaveBeenCalledTimes(1);
      expect(video.pause).toHaveBeenCalledTimes(1);
      expect(getVodRuntimeSourceUrl(video)).toBe(EPISODE_2);
      expect(getManagedVideo(video).__icetvHlsCleanup).toEqual(
        expect.any(Function),
      );
      expect(runtime.setError).not.toHaveBeenCalled();
      expect(runtime.setIsVideoLoading).not.toHaveBeenCalled();
      expect(hls.destroy).not.toHaveBeenCalled();
    });

    it('已释放的运行时收到迟到的失败时不停止加载、不回退路线也不上报失败', () => {
      const runtime = setupRuntime();
      const video = createVideo();
      runtime.load(video, EPISODE_1);
      const hls = getFakeHls(video);
      runManagedVideoCleanup(video);
      runtime.setRealtimeLoadSpeed.mockClear();

      hls.emit(FakeHls.Events.ERROR, NON_FATAL_FRAG_ERROR);
      hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);

      expect(hls.stopLoad).not.toHaveBeenCalled();
      expect(hls.loadSource).toHaveBeenCalledTimes(1);
      expect(runtime.onPlaybackRecoveryExhausted).not.toHaveBeenCalled();
      expect(runtime.setError).not.toHaveBeenCalled();
      expect(runtime.setIsVideoLoading).not.toHaveBeenCalled();
      expect(runtime.setRealtimeLoadSpeed).not.toHaveBeenCalled();
      expect(mockClearSourceProxyOverride).not.toHaveBeenCalled();
      expect(mockReportSourceRouteStat).not.toHaveBeenCalled();
    });
  });
});

describe('vodHlsRuntime 致命网络错误恢复', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    mockIsServerProxy.mockReset().mockReturnValue(false);
    mockShouldAutoFallbackToServer.mockReset().mockReturnValue(false);
    jest.requireMock('@/lib/proxy-modes').rememberSourceServerProxy.mockClear();
    mockClearSourceProxyOverride.mockReset();
    mockReportSourceRouteStat.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createdVideos.splice(0).forEach((video) => runManagedVideoCleanup(video));
    jest.restoreAllMocks();
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  function loadEpisode({ manifestParsed = true } = {}) {
    const runtime = setupRuntime();
    const video = createVideo();
    runtime.load(video, EPISODE_1);
    const hls = getFakeHls(video);
    if (manifestParsed) hls.levels = [{}];
    return { runtime, video, hls };
  }

  // 恢复拉流先重下失败位置之前已部分缓冲的分片并命中浏览器缓存，随后失败分片再次致命失败
  function failAfterCachedReload(hls: FakeHls, delayMs: number) {
    hls.emit(FakeHls.Events.ERROR, fatalFragError(11));
    jest.advanceTimersByTime(delayMs);
    hls.emit(FakeHls.Events.FRAG_LOADED, { frag: mainFragment(10) });
  }

  it('失败位置之前的分片加载成功不清零恢复次数，耗尽后按当前源失败处理', () => {
    const { runtime, hls } = loadEpisode();

    HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.forEach((delayMs) =>
      failAfterCachedReload(hls, delayMs),
    );
    expect(hls.startLoad).toHaveBeenCalledTimes(
      HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.length,
    );
    expect(runtime.onPlaybackRecoveryExhausted).not.toHaveBeenCalled();

    hls.emit(FakeHls.Events.ERROR, fatalFragError(11));

    expect(runtime.onPlaybackRecoveryExhausted).toHaveBeenCalledWith(
      'networkError:fragLoadError',
    );
    expect(runtime.setError).toHaveBeenCalledWith('当前源加载失败');
    expect(hls.stopLoad).toHaveBeenCalledTimes(1);
  });

  it('失败时取消尚未执行的网络恢复，迟到错误保持失败态', () => {
    const { runtime, video, hls } = loadEpisode();
    hls.emit(FakeHls.Events.ERROR, fatalFragError(11));
    for (let i = 0; i <= HLS_FATAL_MEDIA_RECOVERY_LIMIT; i += 1) {
      hls.emit(FakeHls.Events.ERROR, {
        type: FakeHls.ErrorTypes.MEDIA_ERROR,
        details: 'bufferAppendError',
        fatal: true,
      });
    }

    expect(getVodRuntimeSourceUrl(video)).toBeNull();
    expect(runtime.setError).toHaveBeenCalledWith('当前源加载失败');
    jest.runOnlyPendingTimers();
    hls.emit(FakeHls.Events.ERROR, fatalFragError(11));
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.loadSource).toHaveBeenCalledTimes(1);
    expect(runtime.onPlaybackRecoveryExhausted).toHaveBeenCalledTimes(1);
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(
      HLS_FATAL_MEDIA_RECOVERY_LIMIT,
    );
  });

  it('分片加载到失败位置后清零恢复次数，之后的失败重新开始恢复', () => {
    const { runtime, hls } = loadEpisode();

    HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.forEach((delayMs) =>
      failAfterCachedReload(hls, delayMs),
    );
    hls.emit(FakeHls.Events.FRAG_LOADED, { frag: mainFragment(11) });
    hls.emit(FakeHls.Events.ERROR, fatalFragError(12));
    jest.advanceTimersByTime(HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS[0]);

    expect(hls.startLoad).toHaveBeenCalledTimes(
      HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.length + 1,
    );
    expect(runtime.onPlaybackRecoveryExhausted).not.toHaveBeenCalled();
    expect(runtime.setError).not.toHaveBeenCalled();
  });

  it('清单从未加载成功时按当前线路重新拉清单，耗尽后按当前源失败处理', () => {
    const { runtime, hls } = loadEpisode({ manifestParsed: false });
    const directUrl = hls.loadSource.mock.calls[0][0];

    HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.forEach((delayMs) => {
      hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);
      jest.advanceTimersByTime(delayMs);
    });
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.loadSource).toHaveBeenCalledTimes(
      HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.length + 1,
    );
    expect(hls.loadSource).toHaveBeenLastCalledWith(directUrl);

    hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);
    expect(runtime.onPlaybackRecoveryExhausted).toHaveBeenCalledWith(
      'networkError:manifestLoadError',
    );
    expect(runtime.setError).toHaveBeenCalledWith('当前源加载失败');
  });

  describe('自动线路单次切换', () => {
    beforeEach(() => mockShouldAutoFallbackToServer.mockReturnValue(true));
    it('清单失败快速直连转代理，第二路失败交给外层而不循环', () => {
      const { load, onPlaybackRecoveryExhausted } = setupRuntime();
      const video = createVideo();
      load(video, EPISODE_1);
      const hls = getFakeHls(video);
      expect(hls.loadSource).toHaveBeenLastCalledWith(EPISODE_1);
      hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);
      expect(hls.loadSource).toHaveBeenCalledTimes(2);
      expect(hls.loadSource.mock.calls[1][0]).toContain('forceServer=true');
      hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);
      expect(onPlaybackRecoveryExhausted).toHaveBeenCalledTimes(1);
      expect(hls.loadSource).toHaveBeenCalledTimes(2);
    });
    it('失败位置之前的分片不清零阈值，代理到达失败位置后才记忆', () => {
      const { load } = setupRuntime();
      const video = createVideo();
      load(video, EPISODE_1);
      const hls = getFakeHls(video);
      for (let i = 0; i < 3; i++) {
        hls.emit(FakeHls.Events.ERROR, {
          ...NON_FATAL_FRAG_ERROR,
          frag: mainFragment(11),
        });
        hls.emit(FakeHls.Events.FRAG_LOADED, { frag: mainFragment(10) });
      }
      const { rememberSourceServerProxy } =
        jest.requireMock('@/lib/proxy-modes');
      expect(rememberSourceServerProxy).not.toHaveBeenCalled();
      expect(hls.loadSource).toHaveBeenCalledTimes(2);
      hls.emit(FakeHls.Events.FRAG_LOADED, { frag: mainFragment(11) });
      expect(rememberSourceServerProxy).toHaveBeenCalledWith('demo', EPISODE_1);
    });
    it('服务器优先失败只切直连一次', () => {
      mockIsServerProxy.mockReturnValue(true);
      const { load, onPlaybackRecoveryExhausted } = setupRuntime();
      const video = createVideo();
      load(video, EPISODE_1);
      const hls = getFakeHls(video);
      hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);
      expect(hls.loadSource).toHaveBeenLastCalledWith(EPISODE_1);
      hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);
      expect(onPlaybackRecoveryExhausted).toHaveBeenCalled();
      expect(hls.loadSource).toHaveBeenCalledTimes(2);
    });
    it.each([
      'bufferFullError',
      'manifestParsingError',
      'fragParsingError',
      'fragLoadAborted',
    ])('非网络加载错误 %s 不切线路', (details) => {
      const { load } = setupRuntime();
      const video = createVideo();
      load(video, EPISODE_1);
      const hls = getFakeHls(video);
      hls.emit(FakeHls.Events.ERROR, {
        type: 'networkError',
        details,
        fatal: false,
      });
      expect(hls.loadSource).toHaveBeenCalledTimes(1);
    });
    it('同意图重建运行时不重置线路尝试', () => {
      const { options } = setupRuntime();
      options.playbackIntentRef = { current: createVodPlaybackIntent() };
      const load = createVodM3u8Loader(options);
      const video = createVideo();
      load(video, EPISODE_1);
      getFakeHls(video).emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);
      load(video, EPISODE_1);
      const hls = getFakeHls(video);
      const calls = hls.loadSource.mock.calls.length;
      hls.emit(FakeHls.Events.ERROR, FATAL_MANIFEST_ERROR);
      expect(hls.loadSource).toHaveBeenCalledTimes(calls);
    });
  });
});

describe('vodHlsRuntime 卡顿恢复', () => {
  let currentTime = 0;
  let bufferedRanges: Array<[number, number]> = [];

  beforeEach(() => {
    jest.useFakeTimers();
    mockIsServerProxy.mockReset().mockReturnValue(false);
    mockShouldAutoFallbackToServer.mockReset().mockReturnValue(true);
    jest.requireMock('@/lib/proxy-modes').rememberSourceServerProxy.mockClear();
    mockClearSourceProxyOverride.mockReset();
    mockReportSourceRouteStat.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createdVideos.splice(0).forEach((video) => runManagedVideoCleanup(video));
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // 播放停在已缓冲末端附近：剩余缓冲不足以判定无需干预，前方也没有可跳过的小空洞
  function loadStalledEpisode() {
    const runtime = setupRuntime();
    const video = createVideo();
    currentTime = 10;
    bufferedRanges = [[0, 10.2]];
    Object.defineProperties(video, {
      paused: { configurable: true, get: () => false },
      ended: { configurable: true, get: () => false },
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => {
          currentTime = value;
        },
      },
      buffered: {
        configurable: true,
        get: () => ({
          length: bufferedRanges.length,
          start: (index: number) => bufferedRanges[index][0],
          end: (index: number) => bufferedRanges[index][1],
        }),
      },
    });
    runtime.load(video, EPISODE_1);
    return { runtime, video, hls: getFakeHls(video) };
  }

  function confirmStall(video: HTMLVideoElement) {
    video.dispatchEvent(new Event('waiting'));
    jest.advanceTimersByTime(PLAYBACK_STALL_CONFIRMATION_DELAY_MS);
  }

  it.each([
    ['main', 'FRAG_LOADING'],
    ['main', 'FRAG_LOADING_WAITING_RETRY'],
    ['audio', 'FRAG_LOADING'],
  ])('%s 分片处于 %s 时只提示慢速，不重新拉流', (type, state) => {
    const { runtime, video, hls } = loadStalledEpisode();
    hls.inFlightFragments[type] = { frag: mainFragment(11), state };

    confirmStall(video);

    expect(runtime.setRealtimeLoadSpeed).toHaveBeenCalledWith(
      '源站响应较慢，正在继续加载',
    );
    expect(hls.startLoad).not.toHaveBeenCalled();
  });

  it('没有分片在途且缓冲不再增长时补一次拉流', () => {
    const { video, hls } = loadStalledEpisode();

    confirmStall(video);

    expect(hls.startLoad).toHaveBeenCalledTimes(1);
  });

  it('确认期间缓冲仍在增长时不重新拉流', () => {
    const { video, hls } = loadStalledEpisode();

    video.dispatchEvent(new Event('waiting'));
    bufferedRanges = [[0, 11]];
    jest.advanceTimersByTime(PLAYBACK_STALL_CONFIRMATION_DELAY_MS);

    expect(hls.startLoad).not.toHaveBeenCalled();
  });

  it('加载已被停止时交给停止方处理，卡顿恢复不重新拉流', () => {
    const { runtime, video, hls } = loadStalledEpisode();
    hls.loadingEnabled = false;

    confirmStall(video);

    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(runtime.setRealtimeLoadSpeed).not.toHaveBeenCalledWith(
      '源站响应较慢，正在继续加载',
    );
  });
});

describe('vodHlsRuntime 缓冲配额', () => {
  beforeEach(() => {
    mockIsServerProxy.mockReset().mockReturnValue(false);
    mockShouldAutoFallbackToServer.mockReset().mockReturnValue(true);
    jest.requireMock('@/lib/proxy-modes').rememberSourceServerProxy.mockClear();
    mockClearSourceProxyOverride.mockReset();
    mockReportSourceRouteStat.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createdVideos.splice(0).forEach((video) => runManagedVideoCleanup(video));
    jest.restoreAllMocks();
  });

  // 10 秒 12.5MB，即 10Mbps
  const HIGH_BITRATE_FRAG = {
    ...mainFragment(71),
    duration: 10,
    stats: {
      loaded: 12_500_000,
      total: 12_500_000,
      loading: { first: 0, end: 1000 },
    },
  };

  it('高码率分片加载后把前向上限封到字节预算以内', () => {
    const { load } = setupRuntime();
    const video = createVideo();
    load(video, EPISODE_1);
    const hls = getFakeHls(video);

    hls.emit(FakeHls.Events.FRAG_LOADED, { frag: HIGH_BITRATE_FRAG });

    expect(hls.config.maxMaxBufferLength).toBe(80);
    expect(hls.config.maxBufferLength).toBe(80);
  });

  it('bufferFullError 只收紧前向上限，不拉流、不走恢复也不计失败', () => {
    const { load, setError } = setupRuntime();
    const video = createVideo();
    Object.defineProperties(video, {
      currentTime: { configurable: true, get: () => 100 },
      buffered: {
        configurable: true,
        get: () => ({ length: 1, start: () => 90, end: () => 130 }),
      },
    });
    load(video, EPISODE_1);
    const hls = getFakeHls(video);
    hls.emit(FakeHls.Events.FRAG_LOADED, { frag: HIGH_BITRATE_FRAG });
    hls.config.maxMaxBufferLength = 40;

    hls.emit(FakeHls.Events.ERROR, {
      type: FakeHls.ErrorTypes.MEDIA_ERROR,
      details: FakeHls.ErrorDetails.BUFFER_FULL_ERROR,
      parent: 'main',
      fatal: false,
      frag: HIGH_BITRATE_FRAG,
    });

    expect(hls.config.maxMaxBufferLength).toBe(24);
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(hls.recoverMediaError).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
    expect(mockReportSourceRouteStat).not.toHaveBeenCalledWith(
      DETAIL.source,
      'browser',
      false,
    );
  });

  it('复用实例加载下一集时恢复本次加载的原始缓冲配置', () => {
    const { load } = setupRuntime();
    const video = createVideo();
    load(video, EPISODE_1);
    const hls = getFakeHls(video);
    const originalMaxMax = hls.config.maxMaxBufferLength;
    hls.emit(FakeHls.Events.FRAG_LOADED, { frag: HIGH_BITRATE_FRAG });
    expect(hls.config.maxMaxBufferLength).toBe(80);

    hls.stopLoad();
    runManagedVideoCleanup(video);
    load(video, EPISODE_2);

    expect(getFakeHls(video)).toBe(hls);
    expect(hls.config.maxMaxBufferLength).toBe(originalMaxMax);
  });
});
