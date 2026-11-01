import { act, renderHook } from '@testing-library/react';

import type { UseArtPlayerParams } from '@/features/play/hooks/artPlayerTypes';
import { useArtPlayer } from '@/features/play/hooks/useArtPlayer';
import { initializeArtPlayer } from '@/features/play/hooks/useArtPlayer.init';
import { reloadDanmaku } from '@/features/play/lib/danmaku/attach';
import { getManagedVideo, runManagedVideoCleanup } from '@/lib/player-runtime';
import { resolveSourcePlaybackRoute } from '@/lib/proxy-modes';
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
  switchUrl = jest.fn((url: string) => {
    this.option.url = url;
    this.option.customType.m3u8(this.video, url);
    return Promise.resolve();
  });
  private readonly listeners = new Map<string, Listener[]>();

  constructor(public option: MockArtplayerOption) {
    // 与真实 Artplayer 一致：MSE 播放时 url 读到的是 blob 地址而非清单地址
    this.url = 'blob:http://localhost/mock-media-source';
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
  setDanmakuLoadNoticeVisibility: jest.fn(),
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
    playbackRouteRef: { current: null },
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
    jest.mocked(resolveSourcePlaybackRoute).mockReset().mockResolvedValue({
      useServerProxy: false,
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
        resolve({ useServerProxy: true, allowAutoFallback: false });
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
        resolve({ useServerProxy: true, allowAutoFallback: false });
        await flushMicrotasks();
      });
      expect(MockArtplayer.instances).toHaveLength(0);
    });

    it('keeps automatic fallback enabled for the lifetime of the HLS load', async () => {
      jest.mocked(resolveSourcePlaybackRoute).mockResolvedValueOnce({
        useServerProxy: false,
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
        resolve({ useServerProxy: true, allowAutoFallback: false });
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
