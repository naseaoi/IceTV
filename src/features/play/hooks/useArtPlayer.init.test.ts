import { act, renderHook } from '@testing-library/react';

import type { UseArtPlayerParams } from '@/features/play/hooks/artPlayerTypes';
import { useArtPlayer } from '@/features/play/hooks/useArtPlayer';
import { initializeArtPlayer } from '@/features/play/hooks/useArtPlayer.init';
import { reloadDanmaku } from '@/features/play/lib/danmaku/attach';
import { createVodPlaybackIntent } from '@/features/play/lib/vodPlaybackIntent';
import { getManagedVideo, runManagedVideoCleanup } from '@/lib/player-runtime';
import { resolveSourcePlaybackRoute } from '@/lib/proxy-modes';
import { reportSourceRouteStat } from '@/lib/source-route-stats.client';
import type { SearchResult } from '@/lib/types';

type Listener = (...args: unknown[]) => void;

class MockLoader {
  load = jest.fn();
}

class MockHls {
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

  static DefaultConfig = { loader: MockLoader };

  config: Record<string, unknown>;
  levels: unknown[] = [];
  loadingEnabled = true;
  inFlightFragments = { main: { frag: null, state: 'IDLE' } };
  loadSource = jest.fn();
  attachMedia = jest.fn();
  // 与 hls.js 一致：stopLoad 关闭加载开关，startLoad 重新打开
  startLoad = jest.fn(() => {
    this.loadingEnabled = true;
  });
  stopLoad = jest.fn(() => {
    this.loadingEnabled = false;
  });
  destroy = jest.fn();
  recoverMediaError = jest.fn();
  swapAudioCodec = jest.fn();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(config: Record<string, unknown>) {
    this.config = { ...config };
  }

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, data: unknown) {
    [...(this.listeners.get(event) ?? [])].forEach((listener) =>
      listener(event, data),
    );
  }
}

type MockArtplayerOption = {
  url: string;
  autoplay?: boolean;
  screenshot?: boolean;
  moreVideoAttr?: { crossOrigin?: string | null };
  customType: { m3u8: (video: HTMLVideoElement, url: string) => void };
};

class MockArtplayer {
  static USE_RAF = true;
  static FULLSCREEN_WEB_IN_BODY = false;
  static PLAYBACK_RATE: number[] = [];
  static instances: MockArtplayer[] = [];

  video = document.createElement('video');
  template = { $player: document.createElement('div') };
  url: string;
  title = '';
  playing = false;
  notice = { show: '' };
  volume = 0.7;
  playbackRate = 1;
  currentTime = 0;
  duration = 0;
  fullscreenWeb = false;
  destroy = jest.fn();
  pause = jest.fn();
  play = jest.fn(() => Promise.resolve());
  switchUrl = jest.fn((url: string) => {
    this.option.url = url;
    this.option.customType.m3u8(this.video, url);
    return Promise.resolve();
  });
  private readonly listeners = new Map<string, Listener[]>();

  constructor(public option: MockArtplayerOption) {
    // 与真实 Artplayer 一致：MSE 播放时 url 读到的是 blob 地址而非清单地址
    this.url = 'blob:http://localhost/mock-media-source';
    Object.assign(this.video, option.moreVideoAttr);
    // jsdom 把 nullable crossOrigin 的 null 错转为字符串，浏览器实际会移除属性。
    if (option.moreVideoAttr?.crossOrigin === null) {
      this.video.removeAttribute('crossorigin');
    }
    MockArtplayer.instances.push(this);
  }

  off = jest.fn((event: string) => {
    this.listeners.delete(event);
  });

  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  once(event: string, listener: Listener) {
    this.on(event, listener);
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of (this.listeners.get(event) ?? []).slice()) {
      listener(...args);
    }
  }
}

jest.mock('@/lib/player-runtime', () => ({
  ...jest.requireActual('@/lib/player-runtime'),
  bindPlayerHoverControls: jest.fn(),
  bindPlayerMobileControls: jest.fn(),
  getPlayerModules: () =>
    Promise.resolve({ Artplayer: MockArtplayer, Hls: MockHls }),
  prefetchM3U8: jest.fn(),
}));

jest.mock('@/features/play/hooks/usePlayProgress', () => ({
  resolveNextStablePlaybackTime: (time: number) => time,
}));

jest.mock('@/features/play/lib/artPlayerSettings', () => ({
  createArtPlayerContextmenus: () => [],
  createArtPlayerControls: () => [],
  createArtPlayerSettings: () => [],
  syncNextEpisodeControl: jest.fn(),
}));

jest.mock('@/features/play/lib/danmaku/attach', () => ({
  bindDanmakuSettingPersistence: jest.fn(),
  createDanmakuPluginIfEnabled: () => Promise.resolve(null),
  isDanmakuFeatureEnabled: () => false,
  reloadDanmaku: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/features/play/lib/danmaku/load-notice', () => ({
  beginDanmakuLoadNotice: jest.fn(() => jest.fn()),
  waitForDanmakuPlayerSwitch: jest.fn(),
  setDanmakuLoadNoticeVisibility: jest.fn(),
}));

jest.mock('@/features/play/lib/danmaku/slider-drag', () => ({
  bindDanmakuSliderDrag: () => () => undefined,
}));

jest.mock('@/features/play/lib/nextEpisodePreload', () => ({
  getForwardBufferSeconds: jest.requireActual(
    '@/features/play/lib/nextEpisodePreload',
  ).getForwardBufferSeconds,
  scheduleNextEpisodePreload: jest.fn(),
}));

jest.mock('@/lib/proxy-modes', () => ({
  clearSourceProxyOverride: jest.fn(),
  isServerProxy: () => false,
  rememberSourceServerProxy: jest.fn(),
  shouldAutoFallbackToServer: () => false,
  resolveSourcePlaybackRoute: jest.fn(),
}));

jest.mock('@/lib/source-route-stats.client', () => ({
  reportSourceRouteStat: jest.fn(),
}));

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

function createParams(): UseArtPlayerParams {
  return {
    artRef: { current: document.createElement('div') },
    artPlayerRef: { current: null },
    videoUrl: EPISODE_1,
    videoCover: '',
    videoTitle: DETAIL.title,
    loading: false,
    isVideoLoading: true,
    playbackRetryNonce: 0,
    detail: DETAIL,
    currentEpisodeIndex: 0,
    totalEpisodes: DETAIL.episodes.length,
    blockAdEnabled: false,
    blockAdEnabledRef: { current: false },
    autoPlayNextEnabled: false,
    autoPlayNextEnabledRef: { current: false },
    setAutoPlayNextEnabled: jest.fn(),
    skipConfigRef: { current: { enable: false, intro_time: 0, outro_time: 0 } },
    resumeTimeRef: { current: null },
    resumeModeRef: { current: null },
    allowAutoResumeRef: { current: false },
    stableCurrentTimeRef: { current: 0 },
    clearTargetEpisodeProgressRef: { current: false },
    playbackRequestModeRef: { current: 'initial' },
    lastVolumeRef: { current: 0.7 },
    lastPlaybackRateRef: { current: 1 },
    lastSkipCheckRef: { current: 0 },
    lastSaveTimeRef: { current: 0 },
    detailRef: { current: DETAIL },
    currentEpisodeIndexRef: { current: 0 },
    wakeLockRef: { current: null },
    setError: jest.fn(),
    setIsVideoLoading: jest.fn(),
    setIsPlaying: jest.fn(),
    setRealtimeLoadSpeed: jest.fn(),
    setBlockAdEnabled: jest.fn(),
    handleNextEpisode: jest.fn(),
    handleSkipConfigChange: jest.fn(() => Promise.resolve()),
    saveCurrentPlayProgress: jest.fn(),
    requestWakeLock: jest.fn(() => Promise.resolve()),
    releaseWakeLock: jest.fn(() => Promise.resolve()),
    cleanupPlayer: jest.fn(),
    danmakuEnabledRef: { current: false },
  };
}

const createdVideos: HTMLVideoElement[] = [];

// Artplayer 在设置地址后回调 customType，这里手动调用以拿到本次加载的 hls 实例
async function setupPlayer(params = createParams()) {
  const loadingSessionRef = {
    current: {
      pendingInitialResumeTarget: null as number | null,
      playbackStartNotified: false,
    },
  };
  await initializeArtPlayer(params, {
    loadingSessionRef,
    autoAdvanceArmedRef: { current: false },
    autoAdvancedRef: { current: false },
    playerMediaKindRef: { current: null },
    sessionEpisodeIndexRef: { current: null },
    playbackRouteRef: { current: null },
    resumePromptHandledRef: { current: false },
    endPromptsRef: { current: null },
    isCancelled: () => false,
  });
  expect(params.setError).not.toHaveBeenCalledWith('播放器初始化失败');

  const player = MockArtplayer.instances[MockArtplayer.instances.length - 1];
  const { video } = player;
  createdVideos.push(video);
  video.pause = jest.fn();
  if (!params.videoUrl.endsWith('.mp4')) {
    player.option.customType.m3u8(video, player.option.url);
  }
  const hls = getManagedVideo(video).hls as unknown as MockHls;
  return { params, player, video, hls, loadingSessionRef };
}

function findPromptButton(player: MockArtplayer, label: string) {
  const button = Array.from(
    player.template.$player.querySelectorAll<HTMLButtonElement>(
      '.ice-player-prompt button',
    ),
  ).find((item) => item.textContent === label);
  if (!button) throw new Error(`未找到提示按钮：${label}`);
  return button;
}

// 首帧已就绪但尚未播放，满足起播条件
function makeFirstFrameReady(video: HTMLVideoElement) {
  Object.defineProperties(video, {
    readyState: { configurable: true, get: () => 4 },
    videoWidth: { configurable: true, get: () => 1280 },
    buffered: {
      configurable: true,
      get: () => ({ length: 1, start: () => 0, end: () => 10 }),
    },
  });
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

describe('initializeArtPlayer 拉流控制', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockArtplayer.instances = [];
    jest.mocked(resolveSourcePlaybackRoute).mockReset().mockResolvedValue({
      useServerProxy: false,
      directManifest: false,
      allowAutoFallback: false,
    });
    jest.mocked(reloadDanmaku).mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createdVideos.splice(0).forEach((video) => runManagedVideoCleanup(video));
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('HLS 与 MP4 切换时重建播放器并同步截图与 crossorigin', async () => {
    const params = createParams();
    for (const [url, screenshot, crossOrigin] of [
      [EPISODE_1, true, 'anonymous'],
      ['https://cdn.example/movie.mp4', false, null],
      [EPISODE_2, true, 'anonymous'],
    ] as const) {
      const previous = params.artPlayerRef.current;
      params.videoUrl = url;
      const { player, video } = await setupPlayer(params);
      expect(player).not.toBe(previous);
      expect(player.option.screenshot).toBe(screenshot);
      expect(player.option.moreVideoAttr?.crossOrigin).toBe(crossOrigin);
      expect(video.getAttribute('crossorigin')).toBe(crossOrigin);
      expect(video.hasAttribute('crossorigin')).toBe(crossOrigin !== null);
    }
  });

  it.each([
    [4, false, false, true, true],
    [4, true, false, true, false],
    [4, false, true, true, false],
    [4, false, false, false, false],
    [3, false, false, true, false],
  ])(
    '原生错误 %s 的 metadata=%s/playing=%s/auto=%s 回落=%s',
    async (code, metadata, playing, auto, fallback) => {
      jest.mocked(resolveSourcePlaybackRoute).mockResolvedValueOnce({
        useServerProxy: false,
        directManifest: true,
        allowAutoFallback: auto,
      });
      const params = createParams();
      params.videoUrl = 'https://cdn.example/movie.mp4';
      params.onPlaybackRecoveryExhausted = jest.fn(() => false);
      const { player, video } = await setupPlayer(params);
      player.switchUrl.mockImplementation(() => Promise.resolve());
      video.play = jest.fn().mockResolvedValue(undefined);
      if (metadata) player.emit('video:loadedmetadata');
      if (playing) player.emit('video:playing');
      Object.defineProperty(video, 'error', { value: { code } });
      player.emit('video:error', new Error('failed'));
      expect(player.switchUrl).toHaveBeenCalledTimes(fallback ? 1 : 0);
      if (fallback) {
        expect(params.setError).not.toHaveBeenCalledWith('当前源加载失败');
        player.emit('video:error', new Error('failed again'));
        expect(player.switchUrl).toHaveBeenCalledTimes(1);
      }
      expect(params.setError).toHaveBeenCalledWith('当前源加载失败');
    },
  );

  it.each([2, 3])(
    '原生播放中错误 %s 交给换源，未接手时展示失败',
    async (code) => {
      const params = createParams();
      params.videoUrl = 'https://cdn.example/movie.mp4';
      params.onPlaybackRecoveryExhausted = jest.fn(() => false);
      const { player, video } = await setupPlayer(params);
      player.emit('video:playing');
      player.currentTime = 120;
      Object.defineProperty(video, 'error', { value: { code } });
      player.emit('video:error', new Error('failed'));
      expect(params.onPlaybackRecoveryExhausted).toHaveBeenCalledWith(
        code === 2 ? 'native-network-error' : 'native-media-error',
      );
      expect(params.setError).toHaveBeenCalledWith('当前源加载失败');
      expect(params.setIsVideoLoading).toHaveBeenLastCalledWith(false);
    },
  );

  it.each([false, true])(
    '原生线路回落保留目标集进度，pending=%s',
    async (pending) => {
      jest.mocked(resolveSourcePlaybackRoute).mockResolvedValueOnce({
        useServerProxy: false,
        directManifest: true,
        allowAutoFallback: true,
      });
      const params = createParams();
      params.videoUrl = 'https://cdn.example/movie.mp4';
      params.onPlaybackRecoveryExhausted = jest.fn(() => true);
      const { player, video, loadingSessionRef } = await setupPlayer(params);
      Object.defineProperty(video, 'paused', { value: false });
      player.emit('video:playing');
      player.currentTime = 120;
      params.clearTargetEpisodeProgressRef.current = pending;
      params.resumeTimeRef.current = pending ? 45 : null;
      player.switchUrl.mockImplementation(() => {
        player.currentTime = 0;
        return Promise.resolve();
      });
      video.play = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(video, 'error', { value: { code: 2 } });
      player.emit('video:error', new Error('network'));
      expect(player.switchUrl).toHaveBeenCalledTimes(1);
      // 已起播的会话只登记会话落点，不改写 resumeTimeRef
      expect(params.resumeTimeRef.current).toBe(pending ? 45 : null);
      expect(loadingSessionRef.current.pendingInitialResumeTarget).toBe(
        pending ? 45 : 120,
      );
      expect(video.play).toHaveBeenCalled();
      player.duration = 1000;
      player.emit('video:loadedmetadata');
      expect(player.currentTime).toBe(pending ? 45 : 120);
      player.emit('video:error', new Error('network'));
      expect(player.switchUrl).toHaveBeenCalledTimes(1);
      expect(params.onPlaybackRecoveryExhausted).toHaveBeenCalledWith(
        'native-network-error',
      );
      expect(params.setError).not.toHaveBeenCalledWith('当前源加载失败');
    },
  );

  it('原生暂停中回落保持暂停，不开页面加载等待', async () => {
    jest.mocked(resolveSourcePlaybackRoute).mockResolvedValueOnce({
      useServerProxy: false,
      directManifest: true,
      allowAutoFallback: true,
    });
    const params = createParams();
    params.videoUrl = 'https://cdn.example/movie.mp4';
    params.onSourceProxyFallbackStarted = jest.fn();
    const { player, video, loadingSessionRef } = await setupPlayer(params);
    player.emit('video:playing');
    player.currentTime = 120;
    player.switchUrl.mockImplementation(() => Promise.resolve());
    video.play = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, 'error', { value: { code: 2 } });
    jest.mocked(params.setIsVideoLoading).mockClear();

    player.emit('video:error', new Error('network'));

    expect(player.switchUrl).toHaveBeenCalledTimes(1);
    expect(video.play).not.toHaveBeenCalled();
    expect(params.setIsVideoLoading).not.toHaveBeenCalledWith(true);
    expect(params.onSourceProxyFallbackStarted).not.toHaveBeenCalled();
    expect(loadingSessionRef.current.pendingInitialResumeTarget).toBe(120);
  });

  it('原生离线错误等联网处理，运行时释放后移除联网监听', async () => {
    const online = jest
      .spyOn(navigator, 'onLine', 'get')
      .mockReturnValue(false);
    const params = createParams();
    params.videoUrl = 'https://cdn.example/movie.mp4';
    params.onPlaybackRecoveryExhausted = jest.fn(() => true);
    const { player, video } = await setupPlayer(params);
    player.currentTime = 120;
    Object.defineProperty(video, 'error', { value: { code: 2 } });
    player.emit('video:error', new Error('offline'));
    expect(params.onPlaybackRecoveryExhausted).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    expect(params.onPlaybackRecoveryExhausted).toHaveBeenCalledTimes(1);
    online.mockReturnValue(false);
    player.emit('video:error', new Error('offline'));
    runManagedVideoCleanup(video);
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    expect(params.onPlaybackRecoveryExhausted).toHaveBeenCalledTimes(1);
  });

  it.each(['video:timeupdate', 'video:ended'])(
    '释放旧集后 %s 不触发下一集或片尾操作',
    async (event) => {
      const params = createParams();
      params.autoPlayNextEnabledRef.current = true;
      const { player, video } = await setupPlayer(params);
      player.emit('video:playing');
      player.duration = 100;
      player.currentTime = 99.8;
      runManagedVideoCleanup(video);
      player.emit(event);
      expect(params.handleNextEpisode).not.toHaveBeenCalled();
      // 即使重新登记运行时，已释放会话也必须等下一次真实起播再获连播资格。
      player.option.customType.m3u8(video, player.option.url);
      player.emit('video:ended');
      expect(params.handleNextEpisode).not.toHaveBeenCalled();
    },
  );

  describe('完结轻提示', () => {
    function completionParams() {
      const params = createParams();
      params.detailRef.current = { ...DETAIL, episodes: [EPISODE_1] };
      params.detail = params.detailRef.current;
      params.totalEpisodes = 1;
      params.onLastEpisodeNearEnd = jest
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValue(false);
      params.onLastEpisodeEnded = jest.fn();
      return params;
    }

    async function nearEnd(params = completionParams()) {
      const result = await setupPlayer(params);
      result.player.emit('video:playing');
      result.player.duration = 1000;
      result.player.currentTime = 900;
      result.player.emit('video:timeupdate');
      return result;
    }

    it('阈值内在播放器中显示提示，点击小结才请求完整卡片', async () => {
      const { player, params } = await nearEnd();
      expect(player.template.$player.textContent).toContain('本片即将看完');
      expect(params.onLastEpisodeEnded).not.toHaveBeenCalled();
      player.emit('video:timeupdate');
      expect(params.onLastEpisodeNearEnd).toHaveBeenCalledTimes(1);
      expect(findPromptButton(player, '观影小结')).toHaveClass(
        'ice-player-prompt-action-primary',
      );
      findPromptButton(player, '观影小结').click();
      expect(params.onLastEpisodeEnded).toHaveBeenCalledWith(true);
      expect(params.onLastEpisodeEnded).toHaveBeenCalledTimes(1);
      expect(player.template.$player.textContent).not.toContain('本片即将看完');
    });

    it('关闭后不再提示，真实结束仍自动打开卡片', async () => {
      const { player, params } = await nearEnd();
      findPromptButton(player, '关闭').click();
      player.emit('video:timeupdate');
      expect(player.template.$player.textContent).not.toContain('本片即将看完');
      expect(params.onLastEpisodeEnded).not.toHaveBeenCalled();
      player.currentTime = 1000;
      player.emit('video:ended');
      expect(params.onLastEpisodeEnded).toHaveBeenCalledTimes(1);
    });

    it.each(['ended', 'outro'])(
      '忽略轻提示，%s 时收起提示并打开卡片',
      async (reason) => {
        const params = completionParams();
        if (reason === 'outro')
          params.skipConfigRef.current = {
            enable: true,
            intro_time: 0,
            outro_time: -100,
          };
        const { player } = await setupPlayer(params);
        player.emit('video:playing');
        player.duration = 1000;
        player.currentTime = reason === 'outro' ? 810 : 900;
        player.emit('video:timeupdate');
        expect(player.template.$player.textContent).toContain('本片即将看完');
        jest.advanceTimersByTime(2000);
        player.currentTime = reason === 'outro' ? 901 : 1000;
        player.emit(reason === 'outro' ? 'video:timeupdate' : 'video:ended');
        expect(params.onLastEpisodeEnded).toHaveBeenCalledTimes(1);
        expect(params.onLastEpisodeEnded).toHaveBeenLastCalledWith();
        expect(player.template.$player.textContent).toContain('全片已播完');
        expect(
          player.template.$player.querySelectorAll('.ice-player-prompt-end'),
        ).toHaveLength(1);
        jest.advanceTimersByTime(30_000);
        expect(player.template.$player.textContent).toContain('全片已播完');
        findPromptButton(player, '观影小结').click();
        expect(params.onLastEpisodeEnded).toHaveBeenLastCalledWith(true);
        expect(player.template.$player.textContent).toContain('全片已播完');
        expect(player.template.$player.textContent).not.toContain(
          '本片即将看完',
        );
      },
    );

    it.each(['seek', 'replay', 'release', 'destroy'])(
      '末集结束的常驻入口在 %s 时清理',
      async (action) => {
        const { player, params, video } = await nearEnd();
        params.skipConfigRef.current = {
          enable: true,
          intro_time: 60,
          outro_time: 0,
        };
        findPromptButton(player, '观影小结').click();
        player.currentTime = 1000;
        player.emit('video:ended');
        expect(player.template.$player.textContent).toContain('全片已播完');
        if (action === 'seek') {
          player.currentTime = 950;
          player.emit('video:seeking');
        } else if (action === 'replay') {
          findPromptButton(player, '重看').click();
          expect(player.currentTime).toBe(60);
          expect(player.play).toHaveBeenCalled();
        } else if (action === 'release') {
          runManagedVideoCleanup(video);
        } else {
          player.emit('destroy');
        }
        expect(
          player.template.$player.querySelector('.ice-player-prompt-end'),
        ).toBeNull();
      },
    );

    it('连载末集真实结束保持静默', async () => {
      const params = completionParams();
      params.detailRef.current = {
        ...params.detailRef.current!,
        series_status: 'ongoing',
      };
      const { player } = await nearEnd(params);
      player.currentTime = 1000;
      player.emit('video:ended');
      expect(
        player.template.$player.querySelector('.ice-player-prompt-end'),
      ).toBeNull();
      expect(params.onLastEpisodeEnded).not.toHaveBeenCalled();
    });

    it('拖回阈值前立即隐藏，再进入也不重复出现', async () => {
      const { player } = await nearEnd();
      player.currentTime = 500;
      player.emit('video:seeking');
      expect(player.template.$player.textContent).not.toContain('本片即将看完');
      player.currentTime = 900;
      player.emit('video:timeupdate');
      expect(player.template.$player.textContent).not.toContain('本片即将看完');
    });

    it.each([
      'next',
      'parked',
      'pending',
      'not-started',
      'ineligible',
      'released',
    ])('%s 状态不提示', async (condition) => {
      const params = completionParams();
      if (condition === 'next') params.detailRef.current = DETAIL;
      if (condition === 'parked')
        params.startStateRef = {
          current: { parked: true, pendingDuration: null },
        };
      if (condition === 'ineligible')
        params.onLastEpisodeNearEnd = jest.fn().mockReturnValue(false);
      const { player, video } = await setupPlayer(params);
      if (condition !== 'not-started') player.emit('video:playing');
      if (condition === 'pending')
        params.clearTargetEpisodeProgressRef.current = true;
      if (condition === 'released') runManagedVideoCleanup(video);
      player.duration = 1000;
      player.currentTime = 900;
      player.emit('video:timeupdate');
      expect(player.template.$player.textContent).not.toContain('本片即将看完');
      expect(params.onLastEpisodeEnded).not.toHaveBeenCalled();
    });

    it('同组末集即使后面还有其他分组也可提示', async () => {
      const params = completionParams();
      params.detailRef.current = {
        ...DETAIL,
        episode_groups: [
          { label: '原声', count: 1 },
          { label: '配音', count: 1 },
        ],
      };
      const { player } = await nearEnd(params);
      expect(player.template.$player.textContent).toContain('本片即将看完');
      player.emit('video:ended');
      expect(params.onLastEpisodeEnded).toHaveBeenCalledTimes(1);
    });

    it('运行时释放立即隐藏，旧按钮无法打开新源的卡片', async () => {
      const { player, params, video } = await nearEnd();
      const oldButton = findPromptButton(player, '观影小结');
      runManagedVideoCleanup(video);
      expect(player.template.$player.textContent).not.toContain('本片即将看完');
      params.detailRef.current = { ...DETAIL, source: 'other' };
      oldButton.click();
      player.emit('video:timeupdate');
      expect(params.onLastEpisodeEnded).not.toHaveBeenCalled();
    });

    it('hook 换集与换源等待期间同步隐藏提示，复用播放器读取最新回调', async () => {
      const params = completionParams();
      const { rerender, unmount } = renderHook((props) => useArtPlayer(props), {
        initialProps: params,
      });
      await act(flushMicrotasks);
      const player = MockArtplayer.instances.at(-1)!;
      createdVideos.push(player.video);
      player.video.pause = jest.fn();
      player.option.customType.m3u8(player.video, player.option.url);
      player.emit('video:playing');
      player.duration = 1000;
      player.currentTime = 900;
      player.emit('video:timeupdate');
      expect(player.template.$player.textContent).toContain('本片即将看完');
      rerender({ ...params, videoUrl: '' });
      expect(player.template.$player.textContent).not.toContain('本片即将看完');
      const nextDetail = { ...DETAIL, source: 'other', episodes: [EPISODE_2] };
      params.detailRef.current = nextDetail;
      const onLastEpisodeNearEnd = jest
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValue(false);
      const onLastEpisodeEnded = jest.fn();
      rerender({
        ...params,
        detail: nextDetail,
        videoUrl: EPISODE_2,
        onLastEpisodeNearEnd,
        onLastEpisodeEnded,
      });
      await act(flushMicrotasks);
      expect(MockArtplayer.instances).toHaveLength(1);
      player.emit('video:playing');
      player.currentTime = 900;
      player.emit('video:timeupdate');
      expect(onLastEpisodeNearEnd).toHaveBeenCalledTimes(1);
      findPromptButton(player, '观影小结').click();
      expect(onLastEpisodeEnded).toHaveBeenCalledTimes(1);
      expect(params.onLastEpisodeEnded).not.toHaveBeenCalled();
      unmount();
    });
  });

  it('自动跳过片头后，拖回片头重看不再被跳走', async () => {
    const params = createParams();
    params.skipConfigRef.current = {
      enable: true,
      intro_time: 90,
      outro_time: 0,
    };
    const { player } = await setupPlayer(params);
    player.duration = 1400;
    player.currentTime = 10;
    player.emit('video:timeupdate');
    expect(player.currentTime).toBe(90);

    jest.advanceTimersByTime(2000);
    player.currentTime = 10;
    player.emit('video:timeupdate');
    expect(player.currentTime).toBe(10);

    // 换集后播放器上暂留上一集的时间，不能当作新一集已越过片头
    player.option.url = EPISODE_2;
    player.currentTime = 1200;
    jest.advanceTimersByTime(2000);
    player.emit('video:timeupdate');
    player.currentTime = 0;
    jest.advanceTimersByTime(2000);
    player.emit('video:timeupdate');
    expect(player.currentTime).toBe(90);
  });

  it('临近片末显示连播倒计时，立即播放直接切到下一集', async () => {
    const params = createParams();
    params.autoPlayNextEnabledRef.current = true;
    const { player } = await setupPlayer(params);
    player.emit('video:playing');
    player.duration = 1400;
    player.currentTime = 1392.5;
    player.emit('video:timeupdate');
    const prompt = player.template.$player.querySelector('.ice-player-prompt');
    expect(prompt?.textContent).toContain('下一集 · 8 秒后播放');

    player.currentTime = 1395.5;
    player.emit('video:timeupdate');
    expect(prompt?.textContent).toContain('5 秒后播放');

    findPromptButton(player, '立即播放').click();
    expect(params.handleNextEpisode).toHaveBeenCalledTimes(1);
    expect(player.template.$player.querySelector('.ice-player-prompt')).toBe(
      null,
    );
  });

  it('取消连播倒计时后本集播完不再自动切集', async () => {
    const params = createParams();
    params.autoPlayNextEnabledRef.current = true;
    const { player } = await setupPlayer(params);
    player.emit('video:playing');
    player.duration = 1400;
    player.currentTime = 1395;
    player.emit('video:timeupdate');
    findPromptButton(player, '取消').click();
    expect(player.template.$player.querySelector('.ice-player-prompt')).toBe(
      null,
    );

    player.currentTime = 1399.8;
    player.emit('video:timeupdate');
    expect(player.template.$player.querySelector('.ice-player-prompt')).toBe(
      null,
    );
    player.emit('video:ended');
    expect(params.handleNextEpisode).not.toHaveBeenCalled();
  });

  it.each(['video:progress', 'video:ended', 'video:timeupdate'])(
    '停在结尾吸收 %s，不自动连播或展示完结卡片',
    async (event) => {
      const params = createParams();
      params.resumeTimeRef.current = 1398;
      params.resumeModeRef.current = 'forced';
      params.startStateRef = {
        current: { parked: true, pendingDuration: null },
      };
      params.autoPlayNextEnabledRef.current = true;
      params.onLastEpisodeEnded = jest.fn();
      const { player, video } = await setupPlayer(params);
      makeFirstFrameReady(video);
      video.play = jest.fn().mockResolvedValue(undefined);
      player.duration = 1400;
      player.emit(event);
      expect(player.currentTime).toBe(1398);
      expect(params.handleNextEpisode).not.toHaveBeenCalled();
      expect(params.onLastEpisodeEnded).not.toHaveBeenCalled();
      expect(video.play).not.toHaveBeenCalled();
      expect(player.template.$player.textContent).toContain('本集已播完');
      jest.advanceTimersByTime(10_000);
      expect(player.template.$player.textContent).toContain('本集已播完');
      findPromptButton(player, '下一集').click();
      expect(params.handleNextEpisode).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['last', 'next', 'ongoing', 'group-last'])(
    '停在结尾的 %s 集在右下提供对应操作',
    async (kind) => {
      const params = createParams();
      params.startStateRef = {
        current: { parked: true, pendingDuration: null },
      };
      params.resumeTimeRef.current = 1398;
      params.detailRef.current = {
        ...DETAIL,
        episodes:
          kind === 'next' || kind === 'group-last'
            ? DETAIL.episodes
            : [EPISODE_1],
        series_status: kind === 'ongoing' ? 'ongoing' : 'ended',
        ...(kind === 'group-last'
          ? {
              episode_groups: [
                { label: '原声', count: 1 },
                { label: '配音', count: 1 },
              ],
            }
          : {}),
      };
      params.onLastEpisodeEnded = jest.fn();
      const { player } = await setupPlayer(params);
      player.duration = 1400;
      player.emit('video:progress');
      const prompt = player.template.$player.querySelector(
        '.ice-player-prompt-end',
      );
      expect(prompt?.textContent).toContain('本集已播完');
      expect(
        player.template.$player.querySelectorAll('.ice-player-prompt-end'),
      ).toHaveLength(1);
      if (kind === 'last' || kind === 'group-last') {
        findPromptButton(player, '观影小结').click();
        expect(params.onLastEpisodeEnded).toHaveBeenCalledWith(true);
        expect(params.startStateRef.current.parked).toBe(true);
      } else {
        expect(prompt?.textContent).not.toContain('观影小结');
      }
    },
  );

  it.each([5, 600, 1395])(
    '迟到续播共用左下提示并检查位置 %s',
    async (position) => {
      const params = createParams();
      params.startStateRef = {
        current: { parked: false, pendingDuration: null },
      };
      params.skipConfigRef.current = {
        enable: true,
        intro_time: 60,
        outro_time: 0,
      };
      const { player } = await setupPlayer(params);
      player.duration = 1400;
      player.currentTime = position;
      params.startStateRef.current.showResumePrompt?.();
      const prompt = player.template.$player.querySelector(
        '.ice-player-prompt-start',
      );
      if (position === 600) {
        expect(prompt?.textContent).toContain('已从 10:00 继续播放');
        params.startStateRef.current.showResumePrompt?.();
        expect(
          player.template.$player.querySelectorAll('.ice-player-prompt-start'),
        ).toHaveLength(1);
        findPromptButton(player, '从头播放').click();
        expect(player.currentTime).toBe(60);
      } else {
        expect(prompt).toBeNull();
      }
      player.emit('destroy');
      expect(params.startStateRef.current.showResumePrompt).toBeUndefined();
    },
  );

  it('停在结尾后重看遵守片头设置，播放按钮也执行重看', async () => {
    const params = createParams();
    params.resumeTimeRef.current = 1398;
    params.startStateRef = { current: { parked: true, pendingDuration: null } };
    params.skipConfigRef.current = {
      enable: true,
      intro_time: 90,
      outro_time: 0,
    };
    const { player } = await setupPlayer(params);
    player.duration = 1400;
    player.emit('video:progress');
    findPromptButton(player, '重看').click();
    expect(params.startStateRef.current.parked).toBe(false);
    expect(player.currentTime).toBe(90);
    params.startStateRef.current.parked = true;
    player.emit('play');
    expect(params.startStateRef.current.parked).toBe(false);
    expect(player.currentTime).toBe(90);
  });

  it('停在末集时迟到详情只补下一集按钮，用户拖动后退出停住状态', async () => {
    const params = createParams();
    params.detailRef.current = { ...DETAIL, episodes: [EPISODE_1] };
    params.resumeTimeRef.current = 1398;
    params.startStateRef = { current: { parked: true, pendingDuration: null } };
    const { player } = await setupPlayer(params);
    player.duration = 1400;
    player.emit('video:progress');
    expect(player.template.$player.textContent).not.toContain('下一集');
    params.detailRef.current = DETAIL;
    params.startStateRef.current.refreshPrompt?.();
    expect(player.template.$player.textContent).toContain('下一集');
    expect(params.handleNextEpisode).not.toHaveBeenCalled();
    player.currentTime = 600;
    player.emit('video:seeking');
    expect(params.startStateRef.current.parked).toBe(false);
    expect(params.resumeTimeRef.current).toBeNull();
    expect(player.template.$player.textContent).not.toContain('本集已播完');
  });

  it('未开连播时自然播完补存进度', async () => {
    const params = createParams();
    const { player } = await setupPlayer(params);
    player.emit('video:playing');
    player.duration = 1400;
    player.currentTime = 1400;
    (params.saveCurrentPlayProgress as jest.Mock).mockClear();
    player.emit('video:ended');
    expect(params.saveCurrentPlayProgress).toHaveBeenCalledTimes(1);
  });

  it('未开连播时片尾只暂停一次，继续播放不再被反复暂停', async () => {
    const params = createParams();
    params.skipConfigRef.current = {
      enable: true,
      intro_time: 0,
      outro_time: -60,
    };
    const { player } = await setupPlayer(params);
    player.emit('video:playing');
    player.duration = 1400;
    player.currentTime = 1345;
    player.emit('video:timeupdate');
    expect(player.pause).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2000);
    player.currentTime = 1347;
    player.emit('video:timeupdate');
    expect(player.pause).toHaveBeenCalledTimes(1);
  });

  it('统计事件独立于跳片头设置，并屏蔽已释放运行时的迟到采样', async () => {
    const params = createParams();
    params.handlePlaybackStatsEvent = jest.fn();
    const { player, video } = await setupPlayer(params);
    for (const event of [
      'playing',
      'timeupdate',
      'pause',
      'waiting',
      'stalled',
      'seeking',
      'seeked',
      'ended',
      'error',
    ]) {
      player.emit(`video:${event}`);
      expect(params.handlePlaybackStatsEvent).toHaveBeenLastCalledWith(event);
    }
    player.emit('pause');
    expect(params.handlePlaybackStatsEvent).toHaveBeenLastCalledWith('pause');
    jest.mocked(params.handlePlaybackStatsEvent).mockClear();
    runManagedVideoCleanup(video);
    player.emit('video:playing');
    player.emit('video:timeupdate');
    player.emit('video:waiting');
    expect(params.handlePlaybackStatsEvent).not.toHaveBeenCalled();
  });

  it.each(['hls', 'native'])(
    '%s 播放中回落开启加载，恢复只结束等待而不重复通知起播',
    async (kind) => {
      jest.mocked(resolveSourcePlaybackRoute).mockResolvedValueOnce({
        useServerProxy: false,
        directManifest: true,
        allowAutoFallback: true,
      });
      jest.mocked(reportSourceRouteStat).mockClear();
      const params = createParams();
      params.playbackIntentRef = { current: createVodPlaybackIntent() };
      params.onPlaybackStarted = jest.fn();
      params.startPlaybackStatsSession = jest.fn();
      params.onSourceProxyFallbackStarted = jest.fn();
      if (kind === 'native') params.videoUrl = 'https://cdn.example/movie.mp4';
      const { player, video } = await setupPlayer(params);
      if (kind === 'native') {
        player.switchUrl.mockImplementation(() => {
          video.dispatchEvent(new Event('loadstart'));
          return Promise.resolve();
        });
        video.play = jest.fn().mockResolvedValue(undefined);
      }
      Object.defineProperty(video, 'paused', { value: false });
      video.dispatchEvent(new Event('playing'));
      player.emit('video:playing');
      expect(params.onPlaybackStarted).toHaveBeenCalledTimes(1);
      act(() => jest.advanceTimersByTime(300_000));
      const fallback = getManagedVideo(video).__icetvSwitchToServerProxy!;
      expect(fallback('page-loading-timeout')).toBe(true);
      expect(params.setIsVideoLoading).toHaveBeenLastCalledWith(true);
      expect(params.onSourceProxyFallbackStarted).toHaveBeenCalledTimes(1);
      expect(params.playbackIntentRef.current.activeSource?.startedAt).toBe(
        300_000,
      );

      player.emit('video:seeked');
      expect(params.setIsVideoLoading).toHaveBeenLastCalledWith(true);
      video.dispatchEvent(new Event('playing'));
      player.emit('video:playing');
      player.emit('video:playing');
      expect(params.setIsVideoLoading).toHaveBeenLastCalledWith(false);
      expect(params.setRealtimeLoadSpeed).toHaveBeenLastCalledWith('');
      expect(
        params.playbackIntentRef.current.activeSource?.startedAt,
      ).toBeNull();
      expect(params.onPlaybackStarted).toHaveBeenCalledTimes(1);
      expect(params.startPlaybackStatsSession).toHaveBeenCalledTimes(1);
      if (kind === 'native') {
        expect(
          jest
            .mocked(reportSourceRouteStat)
            .mock.calls.filter(
              ([, route, success]) => route === 'server' && success,
            ),
        ).toHaveLength(1);
      }
      runManagedVideoCleanup(video);
      expect(getManagedVideo(video).__icetvSwitchToServerProxy).toBeNull();
      expect(fallback('late-timeout')).toBe(false);
    },
  );

  it('原生运行时释放后已捕获的回落入口与迟到 playing 均失效', async () => {
    jest.mocked(resolveSourcePlaybackRoute).mockResolvedValueOnce({
      useServerProxy: false,
      directManifest: true,
      allowAutoFallback: true,
    });
    const params = createParams();
    params.videoUrl = 'https://cdn.example/movie.mp4';
    params.onPlaybackStarted = jest.fn();
    const { player, video } = await setupPlayer(params);
    const fallback = getManagedVideo(video).__icetvSwitchToServerProxy!;
    runManagedVideoCleanup(video);
    expect(getManagedVideo(video).__icetvSwitchToServerProxy).toBeNull();
    expect(fallback('page-loading-timeout')).toBe(false);
    player.emit('video:playing');
    expect(player.switchUrl).not.toHaveBeenCalled();
    expect(params.onPlaybackStarted).not.toHaveBeenCalled();
    expect(params.setIsVideoLoading).not.toHaveBeenCalledWith(false);
  });

  it('复用加载器按当前源选择规则，rycj 遵守去广告开关', async () => {
    const { params, player, video } = await setupPlayer();
    const content = [
      '#EXTM3U',
      ...Array.from({ length: 8 }, (_, block) => [
        '#EXT-X-DISCONTINUITY',
        ...Array.from(
          { length: 5 },
          (_, fragment) => `#EXTINF:5,\nmain-${block}-${fragment}.ts`,
        ),
      ]).flat(),
      '#EXT-X-ENDLIST',
    ].join('\n');
    const transform = (hls: MockHls) => {
      const Loader = hls.config.loader as new (config: unknown) => MockLoader;
      const loader = new Loader({});
      const callbacks = { onSuccess: jest.fn() };
      const context = { type: 'level', url: EPISODE_1 };
      loader.load(context, {}, callbacks);
      const response = { data: content, url: EPISODE_2 };
      callbacks.onSuccess(response, {}, context);
      return response.data;
    };
    params.blockAdEnabledRef.current = true;
    player.option.customType.m3u8(video, EPISODE_1);
    const hls = getManagedVideo(video).hls as unknown as MockHls;
    expect(transform(hls)).toBe(content);

    params.detailRef.current = { ...DETAIL, source: 'rycj' };
    player.option.customType.m3u8(video, EPISODE_2);
    expect(getManagedVideo(video).hls).toBe(hls);
    expect(transform(hls)).not.toContain('#EXT-X-DISCONTINUITY');
    expect(transform(hls).match(/#EXTINF:/g)).toHaveLength(40);

    params.detailRef.current = DETAIL;
    player.option.customType.m3u8(video, EPISODE_1);
    expect(getManagedVideo(video).hls).toBe(hls);
    expect(transform(hls)).toBe(content);

    params.detailRef.current = { ...DETAIL, source: 'rycj' };
    params.blockAdEnabledRef.current = false;
    player.option.customType.m3u8(video, EPISODE_2);
    const unfilteredHls = getManagedVideo(video).hls as unknown as MockHls;
    expect(unfilteredHls).not.toBe(hls);
    expect(transform(unfilteredHls)).toBe(content);
  });

  describe('routing and detail refresh', () => {
    async function mountHook(params = createParams()) {
      const hook = renderHook((value) => useArtPlayer(value), {
        initialProps: params,
      });
      await act(flushMicrotasks);
      const player = MockArtplayer.instances[0];
      if (player) {
        createdVideos.push(player.video);
        player.video.pause = jest.fn();
        player.option.customType.m3u8(player.video, player.option.url);
      }
      return { ...hook, params, player };
    }

    it('waits for the route and uses the same snapshot for HLS', async () => {
      let resolve!: (route: {
        useServerProxy: boolean;
        directManifest: boolean;
        allowAutoFallback: boolean;
      }) => void;
      jest.mocked(resolveSourcePlaybackRoute).mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const params = createParams();
      const hook = renderHook(() => useArtPlayer(params));
      await act(flushMicrotasks);
      expect(MockArtplayer.instances).toHaveLength(0);
      await act(async () => {
        resolve({
          useServerProxy: true,
          directManifest: false,
          allowAutoFallback: false,
        });
        await flushMicrotasks();
      });
      const player = MockArtplayer.instances[0];
      createdVideos.push(player.video);
      player.option.customType.m3u8(player.video, player.option.url);
      expect(getManagedVideo(player.video).__icetvUsingServerProxy).toBe(true);
      hook.unmount();
    });

    it('discards initialization when the route arrives after unmount', async () => {
      let resolve!: (route: {
        useServerProxy: boolean;
        directManifest: boolean;
        allowAutoFallback: boolean;
      }) => void;
      jest.mocked(resolveSourcePlaybackRoute).mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const hook = renderHook(() => useArtPlayer(createParams()));
      hook.unmount();
      await act(async () => {
        resolve({
          useServerProxy: true,
          directManifest: false,
          allowAutoFallback: false,
        });
        await flushMicrotasks();
      });
      expect(MockArtplayer.instances).toHaveLength(0);
    });

    it('显式直连把原始清单交给 HLS 和 AirPlay，失败仍留在直连', async () => {
      jest.mocked(resolveSourcePlaybackRoute).mockResolvedValueOnce({
        useServerProxy: false,
        directManifest: true,
        allowAutoFallback: false,
      });
      const { player, unmount } = await mountHook();
      const managed = getManagedVideo(player.video);
      expect(managed.hls?.loadSource).toHaveBeenCalledWith(EPISODE_1);
      expect(player.video.querySelector('source')?.src).toBe(EPISODE_1);
      expect(managed.__icetvSwitchToServerProxy?.('timeout')).toBe(false);
      expect(managed.hls?.loadSource).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('keeps automatic fallback enabled for the lifetime of the HLS load', async () => {
      jest.mocked(resolveSourcePlaybackRoute).mockResolvedValueOnce({
        useServerProxy: false,
        directManifest: false,
        allowAutoFallback: true,
      });
      const { player } = await mountHook();
      const managed = getManagedVideo(player.video);
      expect(managed.__icetvSwitchToServerProxy?.('timeout')).toBe(true);
      expect(managed.__icetvUsingServerProxy).toBe(true);
    });

    it('discards an old route response after switching episodes', async () => {
      let resolve!: (route: {
        useServerProxy: boolean;
        directManifest: boolean;
        allowAutoFallback: boolean;
      }) => void;
      jest.mocked(resolveSourcePlaybackRoute).mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const params = createParams();
      const hook = renderHook((value) => useArtPlayer(value), {
        initialProps: params,
      });
      params.currentEpisodeIndexRef.current = 1;
      hook.rerender({ ...params, videoUrl: EPISODE_2, currentEpisodeIndex: 1 });
      await act(flushMicrotasks);
      await act(async () => {
        resolve({
          useServerProxy: true,
          directManifest: false,
          allowAutoFallback: false,
        });
        await flushMicrotasks();
      });
      expect(MockArtplayer.instances).toHaveLength(1);
      expect(MockArtplayer.instances[0].option.url).toBe(EPISODE_2);
    });

    it('keeps in-flight HLS on metadata refresh and consumes latest callbacks', async () => {
      const { params, player, rerender } = await mountHook();
      const hls = getManagedVideo(player.video).hls as unknown as MockHls;
      const started = jest.fn();
      const fresh = {
        ...DETAIL,
        title: 'Updated title',
        episodes: [...DETAIL.episodes, 'https://cdn.example/ep3.m3u8'],
      };
      params.detailRef.current = fresh;
      rerender({
        ...params,
        detail: fresh,
        totalEpisodes: 3,
        onPlaybackStarted: started,
      });
      await act(flushMicrotasks);
      expect(resolveSourcePlaybackRoute).toHaveBeenCalledTimes(1);
      expect(player.switchUrl).not.toHaveBeenCalled();
      expect(hls.stopLoad).not.toHaveBeenCalled();
      expect(player.title).toContain('Updated title');
      expect(reloadDanmaku).not.toHaveBeenCalled();
      player.emit('video:playing');
      expect(started).toHaveBeenCalledTimes(1);
    });

    it('updates remapped episode identity without restarting the same URL', async () => {
      const { params, player, rerender } = await mountHook();
      const fresh = { ...DETAIL, episodes: [EPISODE_2, ...DETAIL.episodes] };
      params.detailRef.current = fresh;
      params.currentEpisodeIndexRef.current = 1;
      rerender({
        ...params,
        detail: fresh,
        currentEpisodeIndex: 1,
        totalEpisodes: 3,
      });
      await act(flushMicrotasks);
      expect(resolveSourcePlaybackRoute).toHaveBeenCalledTimes(1);
      expect(player.switchUrl).not.toHaveBeenCalled();
      expect(reloadDanmaku).toHaveBeenCalledWith(
        player,
        expect.objectContaining({ episodeIndex: 1 }),
        params.danmakuEnabledRef,
      );
    });

    it('reuses HLS and reloads danmaku when the actual episode URL changes', async () => {
      const { params, player, rerender } = await mountHook();
      params.currentEpisodeIndexRef.current = 1;
      rerender({ ...params, videoUrl: EPISODE_2, currentEpisodeIndex: 1 });
      await act(flushMicrotasks);
      expect(MockArtplayer.instances).toHaveLength(1);
      expect(player.switchUrl).toHaveBeenCalledWith(EPISODE_2);
      expect(reloadDanmaku).toHaveBeenCalledWith(
        player,
        expect.objectContaining({ episodeIndex: 1 }),
        params.danmakuEnabledRef,
      );
    });

    it('restores autoplay when switching episodes after a parked start', async () => {
      const params = createParams();
      params.startStateRef = {
        current: { parked: true, pendingDuration: null },
      };
      const { player, rerender } = await mountHook(params);
      expect(player.option.autoplay).toBe(false);
      player.video.autoplay = false;
      params.startStateRef.current.parked = false;
      params.currentEpisodeIndexRef.current = 1;
      rerender({ ...params, videoUrl: EPISODE_2, currentEpisodeIndex: 1 });
      await act(flushMicrotasks);
      expect(player.switchUrl).toHaveBeenCalledWith(EPISODE_2);
      expect(player.video.autoplay).toBe(true);
    });

    it.each(['source', 'id', 'retry', 'ad'] as const)(
      'reinitializes when %s changes',
      async (field) => {
        const { params, rerender } = await mountHook();
        const updated = { ...params };
        if (field === 'source' || field === 'id') {
          updated.detail = { ...DETAIL, [field]: 'changed' };
          updated.detailRef.current = updated.detail;
        } else if (field === 'retry') {
          updated.playbackRetryNonce = 1;
        } else {
          updated.blockAdEnabled = true;
        }
        rerender(updated);
        await act(flushMicrotasks);
        expect(resolveSourcePlaybackRoute).toHaveBeenCalledTimes(2);
        expect(params.cleanupPlayer).toHaveBeenCalledTimes(1);
        expect(MockArtplayer.instances).toHaveLength(2);
      },
    );
  });

  describe('play 事件', () => {
    it('hls 仍在加载时不重新拉流', async () => {
      const { params, player, hls } = await setupPlayer();

      player.emit('play');

      expect(hls.startLoad).not.toHaveBeenCalled();
      expect(params.setIsPlaying).toHaveBeenCalledWith(true);
    });

    it('自动起播被拦截停止加载后，用户点播放只补拉一次', async () => {
      const { player, video, hls } = await setupPlayer();
      makeFirstFrameReady(video);
      video.play = jest.fn(() =>
        Promise.reject(new DOMException('blocked', 'NotAllowedError')),
      );

      player.emit('video:loadeddata');
      await flushMicrotasks();
      expect(hls.stopLoad).toHaveBeenCalledTimes(1);
      expect(hls.startLoad).not.toHaveBeenCalled();

      player.emit('play');
      player.emit('pause');
      player.emit('play');

      expect(hls.startLoad).toHaveBeenCalledTimes(1);
    });

    it('运行时已释放时保持暂停，不重新拉流', async () => {
      const { player, video, hls } = await setupPlayer();
      hls.stopLoad();
      runManagedVideoCleanup(video);

      player.emit('play');

      expect(video.pause).toHaveBeenCalled();
      expect(hls.startLoad).not.toHaveBeenCalled();
    });
  });

  describe('已起播会话的暂停', () => {
    function trackPaused(video: HTMLVideoElement, initial: boolean) {
      let paused = initial;
      Object.defineProperty(video, 'paused', {
        configurable: true,
        get: () => paused,
      });
      return (next: boolean) => {
        paused = next;
      };
    }

    it('自动起播被拦截后，之后的就绪事件不再代为播放', async () => {
      const { player, video } = await setupPlayer();
      makeFirstFrameReady(video);
      video.play = jest.fn(() =>
        Promise.reject(new DOMException('blocked', 'NotAllowedError')),
      );
      player.emit('video:loadeddata');
      await flushMicrotasks();

      video.play = jest.fn(() => Promise.resolve());
      player.emit('video:progress');
      player.emit('video:canplay');

      expect(video.play).not.toHaveBeenCalled();
    });

    it('播放中回落后用户暂停，画面就绪即收起加载层', async () => {
      jest.mocked(resolveSourcePlaybackRoute).mockResolvedValueOnce({
        useServerProxy: false,
        directManifest: true,
        allowAutoFallback: true,
      });
      const params = createParams();
      params.playbackIntentRef = { current: createVodPlaybackIntent() };
      const { player, video } = await setupPlayer(params);
      const setPaused = trackPaused(video, false);
      video.dispatchEvent(new Event('playing'));
      player.emit('video:playing');
      expect(
        getManagedVideo(video).__icetvSwitchToServerProxy!(
          'page-loading-timeout',
        ),
      ).toBe(true);
      expect(params.setIsVideoLoading).toHaveBeenLastCalledWith(true);

      setPaused(true);
      player.emit('pause');
      expect(params.setIsVideoLoading).toHaveBeenLastCalledWith(true);

      makeFirstFrameReady(video);
      player.emit('video:progress');
      expect(params.setIsVideoLoading).toHaveBeenLastCalledWith(false);
    });

    it('资源限流退避期间用户点播放不提前补拉', async () => {
      const { player, hls } = await setupPlayer();
      hls.emit(MockHls.Events.ERROR, {
        type: MockHls.ErrorTypes.NETWORK_ERROR,
        details: 'manifestLoadError',
        fatal: true,
        response: { code: 429 },
        networkDetails: {
          getResponseHeader: (name: string) =>
            name === 'x-icetv-resource-limited' ? '1' : '20',
        },
      });
      expect(hls.stopLoad).toHaveBeenCalled();

      player.emit('play');

      expect(hls.startLoad).not.toHaveBeenCalled();
    });
  });

  describe('起播', () => {
    it('hls 仍在加载时直接播放，不重新拉流', async () => {
      const { player, video, hls } = await setupPlayer();
      makeFirstFrameReady(video);
      video.play = jest.fn(() => Promise.resolve());

      player.emit('video:loadeddata');

      expect(video.play).toHaveBeenCalledTimes(1);
      expect(hls.startLoad).not.toHaveBeenCalled();
    });

    it('加载已停止时先补拉一次再播放', async () => {
      const { player, video, hls } = await setupPlayer();
      makeFirstFrameReady(video);
      video.play = jest.fn(() => Promise.resolve());
      hls.stopLoad();

      player.emit('video:loadeddata');

      expect(hls.startLoad).toHaveBeenCalledTimes(1);
      expect(video.play).toHaveBeenCalledTimes(1);
    });
  });
});

it('移除内建 video:error 重连后保留项目统计监听', async () => {
  const params = createParams();
  params.handlePlaybackStatsEvent = jest.fn();
  const { player } = await setupPlayer(params);
  expect(player.off).toHaveBeenCalledWith('video:error');
  player.emit('video:error', new Error('media'));
  expect(params.handlePlaybackStatsEvent).toHaveBeenCalledWith('error');
});

it('起播后的显式 seek 可归零稳定进度，程序性续播 seek 保持保护', async () => {
  const { resolveSavedPlaybackTime } = jest.requireActual(
    '@/features/play/lib/playProgressRestore',
  );
  const { applyResumeTime } = jest.requireActual(
    '@/features/play/lib/resumePlayback',
  );
  const { player, params, video } = await setupPlayer();
  makeFirstFrameReady(video);
  player.duration = 1500;
  player.currentTime = 120;
  player.emit('video:playing');
  params.stableCurrentTimeRef.current = 120;
  player.currentTime = 0;
  player.emit('video:seeking');
  player.emit('video:seeked');
  expect(params.stableCurrentTimeRef.current).toBe(0);
  expect(resolveSavedPlaybackTime(0, params.stableCurrentTimeRef)).toBe(2);
  applyResumeTime(player, 300);
  player.emit('video:seeking');
  player.emit('video:seeked');
  expect(params.stableCurrentTimeRef.current).toBe(300);
  runManagedVideoCleanup(video);
});

it('禁用内建重连后 video:error 仍驱动原生媒体错误处理', async () => {
  jest.mocked(resolveSourcePlaybackRoute).mockResolvedValue({
    useServerProxy: false,
    directManifest: false,
    allowAutoFallback: false,
  });
  const params = createParams();
  params.videoUrl = 'https://cdn.example/movie.mp4';
  params.onPlaybackRecoveryExhausted = jest.fn();
  const { player, video } = await setupPlayer(params);
  Object.defineProperty(video, 'error', { value: { code: 3 } });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  player.emit('video:error', new Error('decode'));
  expect(params.onPlaybackRecoveryExhausted).toHaveBeenCalledWith(
    'native-media-error',
  );
  runManagedVideoCleanup(video);
  log.mockRestore();
});
