import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { useLivePlayer } from '@/features/live/hooks/useLivePlayer';
import { buildLiveM3u8ProxyUrl } from '@/features/live/lib/livePlaybackRoute';
import type { LiveChannel, LiveSource } from '@/features/live/types';
import { isManagedVideoExpectedAbort } from '@/lib/player-runtime';
import {
  HLS_FATAL_MEDIA_RECOVERY_LIMIT,
  HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS,
} from '@/lib/player-utils';

type Listener = (...args: unknown[]) => void;

class MockHls {
  static Events = {
    MANIFEST_PARSED: 'hlsManifestParsed',
    LEVEL_UPDATED: 'hlsLevelUpdated',
    FRAG_LOADED: 'hlsFragLoaded',
    ERROR: 'hlsError',
  };
  static ErrorTypes = {
    NETWORK_ERROR: 'networkError',
    MEDIA_ERROR: 'mediaError',
    OTHER_ERROR: 'otherError',
  };
  static DefaultConfig = { loader: class {} };
  static instances: MockHls[] = [];

  private listeners = new Map<string, Listener[]>();
  liveSyncPosition = 0;
  loadingEnabled = true;
  loadSource = jest.fn();
  attachMedia = jest.fn();
  startLoad = jest.fn();
  stopLoad = jest.fn();
  recoverMediaError = jest.fn();
  swapAudioCodec = jest.fn();
  destroy = jest.fn(() => {
    this.listeners.clear();
  });

  constructor() {
    MockHls.instances.push(this);
  }

  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener]);
  }

  emit(event: string, data: unknown) {
    for (const listener of (this.listeners.get(event) || []).slice()) {
      listener(event, data);
    }
  }
}

type MockArtplayerOption = {
  url: string;
  muted: boolean;
  volume: number;
  customType: { m3u8: (video: HTMLVideoElement, url: string) => void };
};

class MockArtplayer {
  static USE_RAF = true;
  static FULLSCREEN_WEB_IN_BODY = false;
  static instances: MockArtplayer[] = [];

  video = document.createElement('video');
  fullscreenWeb = false;
  isDestroy = false;
  private listeners = new Map<string, Listener[]>();
  builtinReconnect = jest.fn(() => {
    setTimeout(
      () => this.option.customType.m3u8(this.video, this.option.url),
      1000,
    );
  });
  destroy = jest.fn(() => {
    this.isDestroy = true;
  });

  constructor(public option: MockArtplayerOption) {
    this.video.muted = option.muted;
    this.video.volume = option.volume;
    this.on('video:error', this.builtinReconnect);
    MockArtplayer.instances.push(this);
  }

  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener]);
  }

  off(event: string) {
    this.listeners.delete(event);
  }

  emit(event: string) {
    for (const listener of this.listeners.get(event) || []) listener();
  }
}

jest.mock('@/lib/player-runtime', () => ({
  ...jest.requireActual('@/lib/player-runtime'),
  getPlayerModules: () =>
    Promise.resolve({ Artplayer: MockArtplayer, Hls: MockHls }),
}));

const source: LiveSource = {
  key: 'src',
  name: '测试源',
  url: 'https://example.com/list.m3u',
  from: 'config',
};

const channel: LiveChannel = {
  id: 'ch1',
  lineId: 'line-1',
  tvgId: 'ch1',
  name: '频道一',
  logo: '',
  group: '央视',
  url: 'https://example.com/ch1.m3u8',
};

const nextChannel: LiveChannel = {
  ...channel,
  id: 'ch2',
  tvgId: 'ch2',
  name: '频道二',
  url: 'https://example.com/ch2.m3u8',
};

function renderLivePlayer(
  callbacks: Pick<
    Parameters<typeof useLivePlayer>[0],
    'onFirstFrame' | 'onPlaybackFailed'
  > = {},
) {
  const setIsVideoLoading = jest.fn();
  const setUnsupportedType = jest.fn();
  const artRef = { current: document.createElement('div') };
  const currentSourceRef = { current: source };
  const hook = renderHook(
    ({ currentChannel }: { currentChannel: LiveChannel }) =>
      useLivePlayer({
        ...callbacks,
        videoUrl: currentChannel.url,
        currentChannel,
        currentSourceRef,
        loading: false,
        artRef,
        setIsVideoLoading,
        setUnsupportedType,
      }),
    { initialProps: { currentChannel: channel } },
  );
  return { ...hook, setIsVideoLoading };
}

// 真实 Artplayer 在 url setter 里异步回调 customType，这里手动触发以拿到 hls 实例
async function waitForPlayer(count: number) {
  await waitFor(() => expect(MockArtplayer.instances).toHaveLength(count));
  const player = MockArtplayer.instances[count - 1];
  act(() => {
    player.option.customType.m3u8(player.video, player.option.url);
  });
  return { player, hls: MockHls.instances[MockHls.instances.length - 1] };
}

function emitFatalError(
  hls: MockHls,
  type: string,
  details: string,
  frag?: { sn: number; type: string },
) {
  act(() => {
    hls.emit(MockHls.Events.ERROR, { type, details, fatal: true, frag });
  });
}

function exhaustMediaRecovery(hls: MockHls) {
  for (let i = 0; i <= HLS_FATAL_MEDIA_RECOVERY_LIMIT; i += 1) {
    emitFatalError(hls, MockHls.ErrorTypes.MEDIA_ERROR, 'bufferAppendError');
  }
}

describe('useLivePlayer playback failure', () => {
  let mediaSpies: jest.SpyInstance[] = [];

  beforeEach(() => {
    MockArtplayer.instances = [];
    MockHls.instances = [];
    mediaSpies = [
      jest
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockImplementation(() => Promise.resolve()),
      jest
        .spyOn(HTMLMediaElement.prototype, 'pause')
        .mockImplementation(() => {}),
      jest
        .spyOn(HTMLMediaElement.prototype, 'load')
        .mockImplementation(() => {}),
      jest.spyOn(console, 'error').mockImplementation(() => {}),
      jest.spyOn(console, 'debug').mockImplementation(() => {}),
    ];
  });

  afterEach(() => {
    // 卸载会销毁播放器并调用 jsdom 未实现的 pause/load，须在恢复 spy 之前完成
    cleanup();
    mediaSpies.forEach((spy) => spy.mockRestore());
  });

  it('keeps the narrow-screen mute button visible while hiding only its slider', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/app/globals.css'),
      'utf8',
    );
    expect(css).toMatch(
      /\.art-control-volume\s+\.art-volume-panel\s*\{\s*display:\s*none\s*!important/,
    );
    const volumeRules = [
      ...css.matchAll(/\.art-control-volume\s*\{([^}]+)\}/g),
    ];
    for (const [, declarations] of volumeRules) {
      expect(declarations).not.toMatch(/display:\s*none/);
    }
  });

  it('removes built-in reconnection while keeping managed media error handling', async () => {
    jest.useFakeTimers();
    try {
      const { result } = renderLivePlayer();
      const { player, hls } = await waitForPlayer(1);
      act(() => player.emit('video:error'));
      expect(player.builtinReconnect).not.toHaveBeenCalled();
      expect(isManagedVideoExpectedAbort(player.video)).toBe(true);
      act(() => player.video.dispatchEvent(new Event('pause')));
      expect(player.video.autoplay).toBe(true);
      exhaustMediaRecovery(hls);
      act(() => jest.advanceTimersByTime(1000));
      expect(result.current.playbackFailed).toBe(true);
      expect(MockHls.instances).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores late loaders from destroyed or replaced players and foreign videos', async () => {
    const { result, rerender } = renderLivePlayer();
    const { player } = await waitForPlayer(1);
    act(() => {
      player.option.customType.m3u8(
        document.createElement('video'),
        player.option.url,
      );
      player.isDestroy = true;
      player.option.customType.m3u8(player.video, player.option.url);
      player.isDestroy = false;
      result.current.cleanupPlayer();
    });
    rerender({ currentChannel: nextChannel });
    await waitForPlayer(2);
    act(() => player.option.customType.m3u8(player.video, player.option.url));
    expect(MockHls.instances).toHaveLength(2);
  });

  it.each([
    [true, 0.35],
    [false, 0.35],
    [false, 0],
  ] as const)(
    'preserves mute=%s and volume=%s when rebuilding for another channel',
    async (muted, volume) => {
      const { result, rerender } = renderLivePlayer();
      const { player, hls } = await waitForPlayer(1);
      act(() => hls.emit(MockHls.Events.MANIFEST_PARSED, {}));
      expect(player.video.muted).toBe(true);
      player.video.muted = muted;
      player.video.volume = volume;
      act(() => result.current.cleanupPlayer());
      rerender({ currentChannel: nextChannel });
      const { player: nextPlayer, hls: nextHls } = await waitForPlayer(2);
      act(() => nextHls.emit(MockHls.Events.MANIFEST_PARSED, {}));
      expect(nextPlayer.video.muted).toBe(muted);
      expect(nextPlayer.video.volume).toBe(volume);
    },
  );

  it('preserves sound when reusing the player and retries muted only on autoplay denial', async () => {
    const { rerender } = renderLivePlayer();
    const { player, hls } = await waitForPlayer(1);
    act(() => hls.emit(MockHls.Events.MANIFEST_PARSED, {}));
    player.video.muted = false;
    player.video.volume = 0.4;
    rerender({ currentChannel: nextChannel });
    await waitFor(() =>
      expect((player as unknown as { switch: string }).switch).toContain('ch2'),
    );
    expect(player.video.muted).toBe(false);
    const play = jest.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    play.mockRejectedValueOnce(
      new DOMException('Autoplay denied', 'NotAllowedError'),
    );
    await act(async () => player.emit('video:canplay'));
    expect(play).toHaveBeenCalledTimes(2);
    expect(player.video.muted).toBe(true);
    expect(player.video.volume).toBe(0.4);
  });

  it.each(['AbortError', 'NotSupportedError'])(
    'keeps sound on %s rather than retrying muted',
    async (name) => {
      renderLivePlayer();
      const { player, hls } = await waitForPlayer(1);
      act(() => hls.emit(MockHls.Events.MANIFEST_PARSED, {}));
      player.video.muted = false;
      const play = jest.mocked(HTMLMediaElement.prototype.play);
      play.mockClear();
      play.mockRejectedValueOnce(new DOMException('Failed', name));
      await act(async () => player.emit('video:canplay'));
      expect(play).toHaveBeenCalledTimes(1);
      expect(player.video.muted).toBe(false);
    },
  );

  it('ignores autoplay denial from a released runtime', async () => {
    const { result } = renderLivePlayer();
    const { player, hls } = await waitForPlayer(1);
    act(() => hls.emit(MockHls.Events.MANIFEST_PARSED, {}));
    player.video.muted = false;
    let reject!: (error: Error) => void;
    const play = jest.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    play.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    act(() => {
      player.emit('video:canplay');
      result.current.cleanupPlayer();
    });
    await act(async () =>
      reject(new DOMException('Denied', 'NotAllowedError')),
    );
    expect(play).toHaveBeenCalledTimes(1);
    expect(player.video.muted).toBe(false);
  });

  it.each([true, false])(
    'only starts loading a parsed manifest when loadingEnabled is false (current: %s)',
    async (loadingEnabled) => {
      renderLivePlayer();
      const { player, hls } = await waitForPlayer(1);
      hls.loadingEnabled = loadingEnabled;
      hls.liveSyncPosition = 120;
      const play = jest.mocked(HTMLMediaElement.prototype.play);
      play.mockClear();

      act(() => {
        hls.emit(MockHls.Events.MANIFEST_PARSED, {});
      });

      if (loadingEnabled) {
        expect(hls.startLoad).not.toHaveBeenCalled();
      } else {
        expect(hls.startLoad).toHaveBeenCalledTimes(1);
        expect(hls.startLoad).toHaveBeenCalledWith(-1);
      }
      expect(player.video.currentTime).toBe(120);
      expect(play).toHaveBeenCalled();
    },
  );

  it('enters the player failure state when media recovery is exhausted', async () => {
    const onPlaybackFailed = jest.fn();
    const { result, setIsVideoLoading } = renderLivePlayer({
      onPlaybackFailed,
    });
    const { player, hls } = await waitForPlayer(1);

    exhaustMediaRecovery(hls);

    expect(hls.recoverMediaError).toHaveBeenCalledTimes(
      HLS_FATAL_MEDIA_RECOVERY_LIMIT,
    );
    expect(result.current.playbackFailed).toBe(true);
    expect(hls.destroy).toHaveBeenCalled();
    expect(player.destroy).toHaveBeenCalled();
    expect(result.current.artPlayerRef.current).toBeNull();
    expect(setIsVideoLoading).toHaveBeenLastCalledWith(false);
    expect(onPlaybackFailed).toHaveBeenCalledWith(channel, source.key);
  });

  it('只在首帧上报成功一次，销毁后的迟到事件被忽略', async () => {
    const onFirstFrame = jest.fn();
    const { result } = renderLivePlayer({ onFirstFrame });
    const { player } = await waitForPlayer(1);
    act(() => {
      player.video.dispatchEvent(new Event('canplay'));
      player.video.dispatchEvent(new Event('playing'));
    });
    expect(onFirstFrame).toHaveBeenCalledTimes(1);
    expect(onFirstFrame).toHaveBeenCalledWith(channel, source.key);
    act(() => {
      result.current.cleanupPlayer();
      player.video.dispatchEvent(new Event('canplay'));
    });
    expect(onFirstFrame).toHaveBeenCalledTimes(1);
  });

  it('leaves web fullscreen before destroying the failed player', async () => {
    const { result } = renderLivePlayer();
    const { player, hls } = await waitForPlayer(1);
    player.fullscreenWeb = true;
    const fullscreenWebOnDestroy: boolean[] = [];
    player.destroy.mockImplementation(() => {
      fullscreenWebOnDestroy.push(player.fullscreenWeb);
    });

    exhaustMediaRecovery(hls);

    expect(result.current.playbackFailed).toBe(true);
    expect(fullscreenWebOnDestroy).toEqual([false]);
  });

  it('enters the player failure state when network recovery is exhausted', async () => {
    jest.useFakeTimers();
    try {
      const { result } = renderLivePlayer();
      const { hls } = await waitForPlayer(1);

      for (const delayMs of HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS) {
        emitFatalError(hls, MockHls.ErrorTypes.NETWORK_ERROR, 'levelLoadError');
        act(() => {
          jest.advanceTimersByTime(delayMs);
        });
      }
      expect(hls.startLoad).toHaveBeenCalledTimes(
        HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS.length,
      );
      expect(result.current.playbackFailed).toBe(false);

      emitFatalError(hls, MockHls.ErrorTypes.NETWORK_ERROR, 'levelLoadError');

      expect(result.current.playbackFailed).toBe(true);
      expect(hls.destroy).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the network budget when retries only reload fragments before the failed one', async () => {
    jest.useFakeTimers();
    try {
      const { result } = renderLivePlayer();
      const { hls } = await waitForPlayer(1);
      const failedFragment = { sn: 11, type: 'main' };

      for (const delayMs of HLS_FATAL_NETWORK_RECOVERY_DELAYS_MS) {
        emitFatalError(
          hls,
          MockHls.ErrorTypes.NETWORK_ERROR,
          'fragLoadError',
          failedFragment,
        );
        act(() => {
          jest.advanceTimersByTime(delayMs);
          hls.emit(MockHls.Events.FRAG_LOADED, {
            frag: { sn: 10, type: 'main' },
          });
        });
      }
      expect(result.current.playbackFailed).toBe(false);

      emitFatalError(
        hls,
        MockHls.ErrorTypes.NETWORK_ERROR,
        'fragLoadError',
        failedFragment,
      );

      expect(result.current.playbackFailed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('enters the player failure state on an unrecoverable fatal error', async () => {
    const { result } = renderLivePlayer();
    const { hls } = await waitForPlayer(1);

    emitFatalError(hls, MockHls.ErrorTypes.OTHER_ERROR, 'internalException');

    expect(result.current.playbackFailed).toBe(true);
    expect(hls.destroy).toHaveBeenCalled();
  });

  it('clears the failure state and loads the new channel after switching', async () => {
    const { result, rerender } = renderLivePlayer();
    const { hls } = await waitForPlayer(1);
    exhaustMediaRecovery(hls);
    expect(result.current.playbackFailed).toBe(true);

    // 换台与换源都会先调用 cleanupPlayer
    act(() => {
      result.current.cleanupPlayer();
    });
    expect(result.current.playbackFailed).toBe(false);

    rerender({ currentChannel: nextChannel });
    const { player: nextPlayer } = await waitForPlayer(2);

    expect(nextPlayer.option.url).toBe(
      buildLiveM3u8ProxyUrl({
        rawUrl: nextChannel.url,
        sourceKey: source.key,
        route: 'browser',
      }),
    );
    expect(result.current.playbackFailed).toBe(false);
  });

  it('reloads the current channel with a fresh recovery budget on retry', async () => {
    const { result } = renderLivePlayer();
    const { player, hls } = await waitForPlayer(1);
    exhaustMediaRecovery(hls);
    expect(result.current.playbackFailed).toBe(true);

    act(() => {
      result.current.retryPlayback();
    });
    expect(result.current.playbackFailed).toBe(false);

    const { player: retriedPlayer, hls: retriedHls } = await waitForPlayer(2);
    expect(retriedPlayer).not.toBe(player);
    expect(retriedPlayer.option.url).toBe(player.option.url);

    emitFatalError(
      retriedHls,
      MockHls.ErrorTypes.MEDIA_ERROR,
      'bufferAppendError',
    );
    expect(retriedHls.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(result.current.playbackFailed).toBe(false);
  });
});

describe('useLivePlayer automatic route', () => {
  let mediaSpies: jest.SpyInstance[] = [];
  let hostIndex = 0;

  beforeEach(() => {
    MockArtplayer.instances = [];
    MockHls.instances = [];
    mediaSpies = [
      jest
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockImplementation(() => Promise.resolve()),
      jest
        .spyOn(HTMLMediaElement.prototype, 'pause')
        .mockImplementation(() => {}),
      jest
        .spyOn(HTMLMediaElement.prototype, 'load')
        .mockImplementation(() => {}),
      jest.spyOn(console, 'error').mockImplementation(() => {}),
      jest.spyOn(console, 'debug').mockImplementation(() => {}),
    ];
  });

  afterEach(() => {
    cleanup();
    mediaSpies.forEach((spy) => spy.mockRestore());
  });

  // 回落记忆按主机保存在本标签页，每个用例用独立主机互不影响
  function renderFreshChannel() {
    hostIndex += 1;
    const freshChannel = {
      ...channel,
      url: `https://direct-${hostIndex}.example/live.m3u8`,
    };
    const setIsVideoLoading = jest.fn();
    const onPlaybackFailed = jest.fn();
    const hook = renderHook(() =>
      useLivePlayer({
        onPlaybackFailed,
        videoUrl: freshChannel.url,
        currentChannel: freshChannel,
        currentSourceRef: { current: source },
        loading: false,
        artRef: { current: document.createElement('div') },
        setIsVideoLoading,
        setUnsupportedType: jest.fn(),
      }),
    );
    return { ...hook, freshChannel, onPlaybackFailed };
  }

  function routeUrl(rawUrl: string, route: 'browser' | 'server') {
    return buildLiveM3u8ProxyUrl({ rawUrl, sourceKey: source.key, route });
  }

  function emitNetworkError(hls: MockHls, url: string, fatal = false) {
    act(() => {
      hls.emit(MockHls.Events.ERROR, {
        type: MockHls.ErrorTypes.NETWORK_ERROR,
        details: 'fragLoadError',
        fatal,
        frag: { sn: 1, type: 'main', url },
      });
    });
  }

  it('falls back to the server when a direct request fails before playback', async () => {
    const { freshChannel, onPlaybackFailed } = renderFreshChannel();
    const { player, hls } = await waitForPlayer(1);
    expect(player.option.url).toBe(routeUrl(freshChannel.url, 'browser'));

    emitNetworkError(hls, 'https://cdn.example/seg-1.ts');
    expect(onPlaybackFailed).not.toHaveBeenCalled();

    await waitFor(() =>
      expect((player as unknown as { switch?: string }).switch).toBe(
        routeUrl(freshChannel.url, 'server'),
      ),
    );
  });

  it('keeps the direct route for transient errors after direct playback works', async () => {
    const { freshChannel } = renderFreshChannel();
    const { player, hls } = await waitForPlayer(1);

    act(() => {
      hls.emit(MockHls.Events.FRAG_LOADED, { frag: { sn: 1, type: 'main' } });
    });
    emitNetworkError(hls, 'https://cdn.example/seg-2.ts');

    expect((player as unknown as { switch?: string }).switch).toBeUndefined();
    expect(player.option.url).toBe(routeUrl(freshChannel.url, 'browser'));
  });

  it('does not treat failures of proxied requests as direct failures', async () => {
    renderFreshChannel();
    const { player, hls } = await waitForPlayer(1);

    emitNetworkError(
      hls,
      `${window.location.origin}/api/proxy/m3u8?url=https%3A%2F%2Fx`,
    );

    expect((player as unknown as { switch?: string }).switch).toBeUndefined();
  });

  it('stops with a relay-paused failure instead of retrying', async () => {
    const { result, onPlaybackFailed } = renderFreshChannel();
    const { hls } = await waitForPlayer(1);

    act(() => {
      hls.emit(MockHls.Events.ERROR, {
        type: MockHls.ErrorTypes.NETWORK_ERROR,
        details: 'fragLoadError',
        fatal: false,
        frag: {
          sn: 1,
          type: 'main',
          url: `${window.location.origin}/api/proxy/segment?url=x`,
        },
        networkDetails: {
          getResponseHeader: (name: string) =>
            name === 'x-icetv-relay-paused' ? '1' : null,
        },
      });
    });

    expect(result.current.playbackFailed).toBe(true);
    expect(result.current.relayPaused).toBe(true);
    expect(onPlaybackFailed).not.toHaveBeenCalled();
  });
});
