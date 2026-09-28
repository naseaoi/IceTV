import type { UseArtPlayerParams } from '@/features/play/hooks/artPlayerTypes';
import { initializeArtPlayer } from '@/features/play/hooks/useArtPlayer.init';
import { getManagedVideo, runManagedVideoCleanup } from '@/lib/player-runtime';
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
}

type MockArtplayerOption = {
  url: string;
  customType: { m3u8: (video: HTMLVideoElement, url: string) => void };
};

class MockArtplayer {
  static USE_RAF = true;
  static FULLSCREEN_WEB_IN_BODY = false;
  static PLAYBACK_RATE: number[] = [];
  static instances: MockArtplayer[] = [];

  video = document.createElement('video');
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
  private readonly listeners = new Map<string, Listener[]>();

  constructor(public option: MockArtplayerOption) {
    this.url = option.url;
    MockArtplayer.instances.push(this);
  }

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
}));

jest.mock('@/features/play/lib/danmaku/slider-drag', () => ({
  bindDanmakuSliderDrag: () => () => undefined,
}));

jest.mock('@/features/play/lib/nextEpisodePreload', () => ({
  scheduleNextEpisodePreload: jest.fn(),
}));

jest.mock('@/lib/proxy-modes', () => ({
  clearSourceProxyOverride: jest.fn(),
  isServerProxy: () => false,
  rememberSourceServerProxy: jest.fn(),
  shouldAutoFallbackToServer: () => false,
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
async function setupPlayer() {
  const params = createParams();
  await initializeArtPlayer(params, {
    loadingSessionRef: {
      current: {
        pendingInitialResumeTarget: null,
        playbackStartNotified: false,
      },
    },
    autoAdvanceArmedRef: { current: false },
    autoAdvancedRef: { current: false },
    playerMediaKindRef: { current: null },
    sessionEpisodeIndexRef: { current: null },
    isCancelled: () => false,
  });
  expect(params.setError).not.toHaveBeenCalledWith('播放器初始化失败');

  const player = MockArtplayer.instances[MockArtplayer.instances.length - 1];
  const { video } = player;
  createdVideos.push(video);
  video.pause = jest.fn();
  player.option.customType.m3u8(video, player.option.url);
  const hls = getManagedVideo(video).hls as unknown as MockHls;
  return { params, player, video, hls };
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
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createdVideos.splice(0).forEach((video) => runManagedVideoCleanup(video));
    jest.restoreAllMocks();
    jest.useRealTimers();
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
