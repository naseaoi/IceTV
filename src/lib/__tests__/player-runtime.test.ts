import {
  bindPlayerHoverControls,
  bindPlayerMobileControls,
  createHlsLoaderClass,
  enterPlayerFastForward,
  exitPlayerFastForward,
  getPlayerFastForwardRate,
  getPlayerFastForwardTime,
  isPlayerFastForwarding,
  prefetchM3U8,
  restorePlayerPlaybackRate,
  subscribePlayerFastForwardReset,
} from '@/lib/player-runtime';

describe('播放器模块加载重试', () => {
  afterEach(() => {
    jest.dontMock('artplayer');
    jest.dontMock('hls.js');
  });

  it.each([false, true])(
    '失败后重新导入且成功结果共享，preload=%s',
    async (preload) => {
      let attempts = 0;
      const Artplayer = class {};
      const Hls = class {};
      jest.doMock('artplayer', () => {
        attempts += 1;
        if (attempts === 1) throw new Error('chunk unavailable');
        return { __esModule: true, default: Artplayer };
      });
      jest.doMock('hls.js', () => ({ __esModule: true, default: Hls }));
      jest.resetModules();
      const runtime = await import('@/lib/player-runtime');
      if (preload) {
        runtime.preloadPlayerModules();
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      } else {
        await expect(runtime.getPlayerModules()).rejects.toThrow(
          'chunk unavailable',
        );
      }
      await expect(runtime.getPlayerModules()).resolves.toEqual({
        Artplayer,
        Hls,
      });
      await expect(runtime.getPlayerModules()).resolves.toEqual({
        Artplayer,
        Hls,
      });
      expect(attempts).toBe(2);
    },
  );
});

describe('prefetchM3U8', () => {
  it('跳过直连清单，代理清单仍预热服务端缓存', () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
    try {
      prefetchM3U8('https://cdn.example/index.m3u8', { directManifest: true });
      expect(fetchMock).not.toHaveBeenCalled();
      const url = '/api/proxy/m3u8?url=test';
      prefetchM3U8(url, { directManifest: false });
      expect(fetchMock).toHaveBeenCalledWith(url, {
        cache: 'no-store',
        headers: { 'X-IceTV-Warm-Only': '1' },
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('createHlsLoaderClass', () => {
  it.each(['manifest', 'level'])(
    '将 %s 的最终响应地址传入转换器，并回退到请求地址',
    (type) => {
      class Loader {
        load = jest.fn();
      }
      const transformManifestText = jest.fn(
        (text: string) => text + '\nfiltered',
      );
      const Wrapped = createHlsLoaderClass(Loader, { transformManifestText });
      for (const url of ['https://final.example/level/index.m3u8', undefined]) {
        const context = { type, url: 'https://initial.example/index.m3u8' };
        const callbacks = { onSuccess: jest.fn() };
        new Wrapped({}).load(context, {}, callbacks);
        const response = { data: '#EXTM3U', url };
        callbacks.onSuccess(response, {}, context);
        expect(transformManifestText).toHaveBeenLastCalledWith(
          '#EXTM3U',
          context,
          url || context.url,
        );
        expect(response.data).toBe('#EXTM3U\nfiltered');
      }
    },
  );

  it('中转暂停响应不再重试，其他失败沿用原重试判断', () => {
    let pausedHeader: string | null = '1';
    let received: any;
    class Loader {
      loader = {
        getResponseHeader: (name: string) =>
          name === 'x-icetv-relay-paused' ? pausedHeader : null,
      };
      load = jest.fn((_context, config) => {
        received = config;
      });
    }
    const Wrapped = createHlsLoaderClass(Loader, {});
    const original = { loadPolicy: { errorRetry: { maxNumRetry: 5 } } };
    new Wrapped({}).load({ type: 'manifest' }, original, {});
    const shouldRetry = received.loadPolicy.errorRetry.shouldRetry;

    expect(shouldRetry({}, 0, false, { code: 503 }, true)).toBe(false);
    pausedHeader = null;
    expect(shouldRetry({}, 0, false, { code: 503 }, true)).toBe(true);
    expect(original.loadPolicy.errorRetry).not.toHaveProperty('shouldRetry');
  });
});

type Listener = (...args: unknown[]) => void;

function createHoverControlsHarness({
  mobile = false,
  finePointer = false,
} = {}) {
  const player = document.createElement('div');
  if (mobile) {
    player.classList.add('art-mobile');
  }
  player.innerHTML =
    '<div class="art-control-setting"><i class="art-icon"></i></div><div class="art-settings"></div>';
  const gear = player.querySelector<HTMLElement>('.art-control-setting')!;
  const gearIcon = gear.querySelector<HTMLElement>('.art-icon')!;
  const panel = player.querySelector<HTMLElement>('.art-settings')!;
  // 模拟 ArtPlayer 齿轮的内置点击切换
  const builtinToggle = jest.fn(() => {
    art.setting.show = !art.setting.show;
  });
  gear.addEventListener('click', builtinToggle);
  document.body.appendChild(player);
  window.matchMedia = jest.fn((query: string) => ({
    matches: finePointer && query === '(hover: hover) and (pointer: fine)',
  })) as unknown as typeof window.matchMedia;

  const listeners = new Map<string, Set<Listener>>();
  let controlsVisible = false;
  let settingVisible = false;

  const emit = (event: string, ...args: unknown[]) => {
    listeners.get(event)?.forEach((listener) => listener(...args));
  };

  const art = {
    controls: {
      get show() {
        return controlsVisible;
      },
      set show(value: boolean) {
        controlsVisible = value;
        emit('control', value);
      },
    },
    setting: {
      get show() {
        return settingVisible;
      },
      set show(value: boolean) {
        settingVisible = value;
        emit('setting', value);
      },
      resize: jest.fn(),
      render: jest.fn(),
    },
    template: { $player: player },
    on: jest.fn((event: string, listener: Listener) => {
      const eventListeners = listeners.get(event) ?? new Set<Listener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    off: jest.fn((event: string, listener?: Listener) => {
      if (!listener) {
        listeners.delete(event);
        return;
      }
      listeners.get(event)?.delete(listener);
    }),
  };

  return {
    art,
    emit,
    player,
    gear,
    gearIcon,
    panel,
    builtinToggle,
    get controlsVisible() {
      return controlsVisible;
    },
    setControlsVisible(value: boolean) {
      art.controls.show = value;
    },
    setSettingVisible(value: boolean) {
      art.setting.show = value;
    },
    get settingVisible() {
      return settingVisible;
    },
  };
}

function createTouchEvent(type: string, x = 0, y = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value:
      type === 'touchend' || type === 'touchcancel'
        ? []
        : [{ clientX: x, clientY: y }],
  });
  return event;
}

function createMobileControlsHarness({ mobile = true } = {}) {
  const player = document.createElement('div');
  const video = document.createElement('video');
  const bottom = document.createElement('div');
  const progress = document.createElement('div');
  const lockLayer = document.createElement('div');
  const listeners = new Map<string, Set<Listener>>();
  let controlsVisible = false;
  let settingVisible = false;
  let playbackRate = 1;

  if (mobile) {
    player.classList.add('art-mobile');
  }
  bottom.className = 'art-bottom';
  progress.className = 'art-progress';
  lockLayer.className = 'art-layer-lock';
  bottom.appendChild(progress);
  player.appendChild(video);
  player.appendChild(bottom);
  player.appendChild(lockLayer);
  document.body.appendChild(player);

  const emit = (event: string, ...args: unknown[]) => {
    listeners.get(event)?.forEach((listener) => listener(...args));
  };

  const art = {
    constructor: {
      DBCLICK_TIME: 300,
      FAST_FORWARD_TIME: 1_000,
      FAST_FORWARD_VALUE: 3,
    },
    controls: {
      get show() {
        return controlsVisible;
      },
      set show(value: boolean) {
        controlsVisible = value;
      },
    },
    setting: {
      get show() {
        return settingVisible;
      },
      set show(value: boolean) {
        settingVisible = value;
      },
    },
    template: { $player: player, $video: video },
    __icetvFastForwardActive: false,
    isLock: false,
    playing: true,
    toggle: jest.fn(),
    get playbackRate() {
      return playbackRate;
    },
    set playbackRate(value: number) {
      playbackRate = value;
    },
    on: jest.fn((event: string, listener: Listener) => {
      const eventListeners = listeners.get(event) ?? new Set<Listener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    off: jest.fn((event: string, listener?: Listener) => {
      if (!listener) {
        listeners.delete(event);
        return;
      }
      listeners.get(event)?.delete(listener);
    }),
  };

  return {
    art,
    bottom,
    emit,
    lockLayer,
    player,
    progress,
    video,
    get controlsVisible() {
      return controlsVisible;
    },
    setControlsVisible(value: boolean) {
      art.controls.show = value;
    },
    setSettingVisible(value: boolean) {
      art.setting.show = value;
    },
    get settingVisible() {
      return settingVisible;
    },
    get playbackRate() {
      return playbackRate;
    },
  };
}

describe('player runtime hover controls', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    document.body.innerHTML = '';
    // jsdom 不提供 matchMedia，harness 临时安装
    delete (window as Partial<Window>).matchMedia;
  });

  it('shows controls when the mouse enters the player', () => {
    const harness = createHoverControlsHarness();
    bindPlayerHoverControls(harness.art);

    harness.player.dispatchEvent(new MouseEvent('mouseenter'));

    expect(harness.controlsVisible).toBe(true);
  });

  it('hides controls and settings when the mouse leaves the player', () => {
    const harness = createHoverControlsHarness();
    bindPlayerHoverControls(harness.art);

    harness.player.dispatchEvent(new MouseEvent('mouseenter'));
    harness.setSettingVisible(true);
    harness.player.dispatchEvent(new MouseEvent('mouseleave'));

    expect(harness.controlsVisible).toBe(false);
    expect(harness.settingVisible).toBe(false);
  });

  it('restores controls when ArtPlayer hides them while the mouse stays inside', () => {
    const harness = createHoverControlsHarness();
    bindPlayerHoverControls(harness.art);

    harness.player.dispatchEvent(new MouseEvent('mouseenter'));
    harness.setControlsVisible(false);

    expect(harness.controlsVisible).toBe(true);
  });

  it('hides controls after two seconds without mouse movement', () => {
    const harness = createHoverControlsHarness();
    bindPlayerHoverControls(harness.art);

    harness.player.dispatchEvent(new MouseEvent('mouseenter'));
    jest.advanceTimersByTime(1_999);

    expect(harness.controlsVisible).toBe(true);

    jest.advanceTimersByTime(1);

    expect(harness.controlsVisible).toBe(false);
  });

  it('resets the idle timer while the mouse moves', () => {
    const harness = createHoverControlsHarness();
    bindPlayerHoverControls(harness.art);

    harness.player.dispatchEvent(new MouseEvent('mouseenter'));
    jest.advanceTimersByTime(1_500);
    harness.player.dispatchEvent(new MouseEvent('mousemove'));
    jest.advanceTimersByTime(1_500);

    expect(harness.controlsVisible).toBe(true);

    jest.advanceTimersByTime(500);

    expect(harness.controlsVisible).toBe(false);
  });

  it('keeps controls hidden after the idle timeout on player ticks', () => {
    const harness = createHoverControlsHarness();
    bindPlayerHoverControls(harness.art);

    harness.player.dispatchEvent(new MouseEvent('mouseenter'));
    jest.advanceTimersByTime(2_000);
    harness.emit('video:timeupdate');

    expect(harness.controlsVisible).toBe(false);
  });

  it('removes hover listeners during cleanup', () => {
    const harness = createHoverControlsHarness();
    const cleanup = bindPlayerHoverControls(harness.art);

    cleanup();
    harness.player.dispatchEvent(new MouseEvent('mouseenter'));
    harness.emit('video:timeupdate');

    expect(harness.controlsVisible).toBe(false);
  });

  it('skips hover controls on ArtPlayer mobile players', () => {
    const harness = createHoverControlsHarness({ mobile: true });
    bindPlayerHoverControls(harness.art);

    harness.player.dispatchEvent(new MouseEvent('mouseenter'));

    expect(harness.controlsVisible).toBe(false);
  });

  it('opens settings on gear hover, keeps them open across the panel, and closes back to the root menu after leaving', () => {
    const harness = createHoverControlsHarness({ finePointer: true });
    bindPlayerHoverControls(harness.art);

    harness.gear.dispatchEvent(new MouseEvent('mouseenter'));
    expect(harness.settingVisible).toBe(true);
    expect(harness.art.setting.resize).toHaveBeenCalled();

    harness.gear.dispatchEvent(new MouseEvent('mouseleave'));
    jest.advanceTimersByTime(200);
    harness.panel.dispatchEvent(new MouseEvent('mouseenter'));
    jest.advanceTimersByTime(1_000);
    expect(harness.settingVisible).toBe(true);

    harness.panel.dispatchEvent(new MouseEvent('mouseleave'));
    jest.advanceTimersByTime(249);
    expect(harness.settingVisible).toBe(true);
    jest.advanceTimersByTime(1);
    expect(harness.settingVisible).toBe(false);
    expect(harness.art.setting.render).toHaveBeenCalled();
  });

  it('keeps hover-opened settings open when the gear is clicked', () => {
    const harness = createHoverControlsHarness({ finePointer: true });
    bindPlayerHoverControls(harness.art);

    harness.gear.dispatchEvent(new MouseEvent('mouseenter'));
    harness.gearIcon.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(harness.builtinToggle).not.toHaveBeenCalled();
    expect(harness.settingVisible).toBe(true);
  });

  it('keeps the built-in click toggle without a fine hover pointer', () => {
    const harness = createHoverControlsHarness();
    bindPlayerHoverControls(harness.art);

    harness.gear.dispatchEvent(new MouseEvent('mouseenter'));
    expect(harness.settingVisible).toBe(false);

    harness.gearIcon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(harness.builtinToggle).toHaveBeenCalledTimes(1);
    expect(harness.settingVisible).toBe(true);
  });

  it('does not idle-hide controls while settings are open', () => {
    const harness = createHoverControlsHarness();
    bindPlayerHoverControls(harness.art);

    harness.player.dispatchEvent(new MouseEvent('mouseenter'));
    harness.setSettingVisible(true);
    jest.advanceTimersByTime(2_000);

    expect(harness.controlsVisible).toBe(true);
    expect(harness.settingVisible).toBe(true);
  });

  it('removes setting hover listeners during cleanup', () => {
    const harness = createHoverControlsHarness({ finePointer: true });
    const cleanup = bindPlayerHoverControls(harness.art);

    cleanup();
    harness.gear.dispatchEvent(new MouseEvent('mouseenter'));
    expect(harness.settingVisible).toBe(false);
    harness.gearIcon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(harness.builtinToggle).toHaveBeenCalledTimes(1);
  });
});

describe('player runtime mobile controls', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  it('uses temporary fast forward and suppresses the next click after long press', () => {
    const harness = createMobileControlsHarness();
    const clickListener = jest.fn();
    harness.setControlsVisible(true);
    harness.video.addEventListener('click', clickListener);
    bindPlayerMobileControls(harness.art);

    harness.video.dispatchEvent(createTouchEvent('touchstart', 10, 10));
    jest.advanceTimersByTime(1_000);

    expect(harness.playbackRate).toBe(3);
    expect(harness.controlsVisible).toBe(false);
    expect(isPlayerFastForwarding(harness.art)).toBe(true);

    document.dispatchEvent(createTouchEvent('touchend'));
    harness.video.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(harness.playbackRate).toBe(1);
    expect(clickListener).not.toHaveBeenCalled();
    expect(isPlayerFastForwarding(harness.art)).toBe(false);
  });

  it('keeps temporary fast forward available while locked', () => {
    const harness = createMobileControlsHarness();
    harness.art.isLock = true;
    harness.setControlsVisible(true);
    bindPlayerMobileControls(harness.art);

    harness.video.dispatchEvent(createTouchEvent('touchstart', 10, 10));
    jest.advanceTimersByTime(1_000);

    expect(harness.playbackRate).toBe(3);
    expect(harness.controlsVisible).toBe(false);
    expect(isPlayerFastForwarding(harness.art)).toBe(true);

    document.dispatchEvent(createTouchEvent('touchend'));

    expect(harness.playbackRate).toBe(1);
    expect(isPlayerFastForwarding(harness.art)).toBe(false);
  });

  it('keeps normal taps available before the long press threshold', () => {
    const harness = createMobileControlsHarness();
    const clickListener = jest.fn();
    harness.video.addEventListener('click', clickListener);
    bindPlayerMobileControls(harness.art);

    harness.video.dispatchEvent(createTouchEvent('touchstart', 10, 10));
    jest.advanceTimersByTime(999);
    document.dispatchEvent(createTouchEvent('touchend'));
    harness.video.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(harness.playbackRate).toBe(1);
    expect(clickListener).toHaveBeenCalledTimes(1);
  });

  it('can disable long press fast forward without disabling lock guards', () => {
    const harness = createMobileControlsHarness();
    const progressListener = jest.fn();
    harness.art.isLock = true;
    harness.progress.addEventListener('touchstart', progressListener);
    bindPlayerMobileControls(harness.art, {
      enableLongPressFastForward: false,
    });

    harness.video.dispatchEvent(createTouchEvent('touchstart', 10, 10));
    jest.advanceTimersByTime(1_000);
    harness.progress.dispatchEvent(createTouchEvent('touchstart', 10, 10));
    harness.emit('dblclick');

    expect(harness.playbackRate).toBe(1);
    expect(isPlayerFastForwarding(harness.art)).toBe(false);
    expect(progressListener).not.toHaveBeenCalled();
    expect(harness.art.toggle).toHaveBeenCalledTimes(1);
  });

  it('blocks locked control events and keeps the lock layer clickable', () => {
    const harness = createMobileControlsHarness();
    const progressListener = jest.fn();
    const lockListener = jest.fn();
    harness.art.isLock = true;
    harness.progress.addEventListener('touchstart', progressListener);
    harness.lockLayer.addEventListener('touchstart', lockListener);
    bindPlayerMobileControls(harness.art);

    harness.progress.dispatchEvent(createTouchEvent('touchstart', 10, 10));
    harness.lockLayer.dispatchEvent(createTouchEvent('touchstart', 10, 10));

    expect(progressListener).not.toHaveBeenCalled();
    expect(lockListener).toHaveBeenCalledTimes(1);
  });

  it('keeps double click play toggle available while locked', () => {
    const harness = createMobileControlsHarness();
    harness.art.isLock = true;
    bindPlayerMobileControls(harness.art);

    harness.emit('dblclick');

    expect(harness.art.toggle).toHaveBeenCalledTimes(1);
  });

  it('double tap seeks on the sides and toggles playback in the middle', () => {
    const harness = createMobileControlsHarness();
    const art = harness.art as typeof harness.art & {
      currentTime: number;
      duration: number;
    };
    art.currentTime = 100;
    art.duration = 1_000;
    jest.spyOn(harness.player, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 300,
    } as DOMRect);
    bindPlayerMobileControls(harness.art, { doubleTapSeekSeconds: 10 });

    harness.emit('dblclick', new MouseEvent('click', { clientX: 280 }));
    harness.emit('dblclick', new MouseEvent('click', { clientX: 290 }));
    expect(art.currentTime).toBe(120);
    expect(
      harness.player.querySelector('.ice-seek-feedback')?.textContent,
    ).toBe('20 秒');

    harness.emit('dblclick', new MouseEvent('click', { clientX: 20 }));
    expect(art.currentTime).toBe(110);
    harness.emit('dblclick', new MouseEvent('click', { clientX: 150 }));
    expect(art.currentTime).toBe(110);
    expect(harness.art.toggle).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1_000);
    expect(harness.player.querySelector('.ice-seek-feedback')).toBeNull();
  });

  it('double tap toggles playback anywhere without seek option', () => {
    const harness = createMobileControlsHarness();
    bindPlayerMobileControls(harness.art);

    harness.emit('dblclick', new MouseEvent('click', { clientX: 5 }));

    expect(harness.art.toggle).toHaveBeenCalledTimes(1);
  });

  it('does not bind mobile controls without ArtPlayer mobile class', () => {
    const harness = createMobileControlsHarness({ mobile: false });
    const clickListener = jest.fn();
    harness.video.addEventListener('click', clickListener);
    bindPlayerMobileControls(harness.art);

    harness.video.dispatchEvent(createTouchEvent('touchstart', 10, 10));
    jest.advanceTimersByTime(1_000);
    harness.video.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(harness.playbackRate).toBe(1);
    expect(clickListener).toHaveBeenCalledTimes(1);
  });

  it('restores a temporary fast forward rate to the persistent rate', () => {
    const harness = createMobileControlsHarness();
    harness.art.__icetvFastForwardActive = true;
    harness.art.playbackRate = 3;
    harness.player.classList.add('art-fast-forward');

    restorePlayerPlaybackRate(harness.art, 1.5);

    expect(harness.playbackRate).toBe(1.5);
    expect(harness.player.classList.contains('art-fast-forward')).toBe(false);
    expect(harness.art.__icetvFastForwardActive).toBe(false);
  });

  it('shares fast-forward entry and exit helpers using ArtPlayer defaults', () => {
    const harness = createMobileControlsHarness();
    harness.art.playbackRate = 1.25;

    expect(getPlayerFastForwardTime(harness.art)).toBe(1_000);
    expect(getPlayerFastForwardRate(harness.art)).toBe(3);

    const state = enterPlayerFastForward(harness.art);
    expect(state).toEqual({ previousPlaybackRate: 1.25, fastForwardRate: 3 });
    expect(harness.playbackRate).toBe(3);
    expect(isPlayerFastForwarding(harness.art)).toBe(true);
    expect(harness.player.classList.contains('art-fast-forward')).toBe(true);

    exitPlayerFastForward(harness.art, state!.previousPlaybackRate);
    expect(harness.playbackRate).toBe(1.25);
    expect(isPlayerFastForwarding(harness.art)).toBe(false);
    expect(harness.player.classList.contains('art-fast-forward')).toBe(false);
  });

  it('refuses to slow down when playbackRate is already at or above fast-forward rate', () => {
    const harness = createMobileControlsHarness();
    harness.art.playbackRate = 3.5;

    expect(enterPlayerFastForward(harness.art)).toBeNull();
    expect(harness.playbackRate).toBe(3.5);
    expect(isPlayerFastForwarding(harness.art)).toBe(false);

    bindPlayerMobileControls(harness.art);
    harness.video.dispatchEvent(createTouchEvent('touchstart', 10, 10));
    jest.advanceTimersByTime(1_000);

    expect(harness.playbackRate).toBe(3.5);
    expect(isPlayerFastForwarding(harness.art)).toBe(false);
  });

  it('ignores a second fast-forward entry while already fast-forwarding', () => {
    const harness = createMobileControlsHarness();
    harness.art.playbackRate = 1.25;
    const cleanupMobile = bindPlayerMobileControls(harness.art);

    // 触控长按先进入 3x，期间键盘长按不得重复进入并把 3x 当作原倍速
    harness.video.dispatchEvent(createTouchEvent('touchstart', 10, 10));
    jest.advanceTimersByTime(1_000);
    expect(harness.playbackRate).toBe(3);
    expect(enterPlayerFastForward(harness.art)).toBeNull();

    document.dispatchEvent(createTouchEvent('touchend'));
    expect(harness.playbackRate).toBe(1.25);
    expect(isPlayerFastForwarding(harness.art)).toBe(false);

    // 键盘先进入 3x，期间触控长按与移动端清理都不应破坏键盘倍速
    const keyboardHandle = enterPlayerFastForward(harness.art);
    expect(keyboardHandle).toEqual({
      previousPlaybackRate: 1.25,
      fastForwardRate: 3,
    });
    harness.video.dispatchEvent(createTouchEvent('touchstart', 10, 10));
    jest.advanceTimersByTime(1_000);
    document.dispatchEvent(createTouchEvent('touchend'));
    expect(harness.playbackRate).toBe(3);
    expect(isPlayerFastForwarding(harness.art)).toBe(true);

    cleanupMobile();
    expect(isPlayerFastForwarding(harness.art)).toBe(true);

    exitPlayerFastForward(harness.art, keyboardHandle!.previousPlaybackRate);
    expect(harness.playbackRate).toBe(1.25);
    expect(isPlayerFastForwarding(harness.art)).toBe(false);
  });

  it('notifies reset subscribers and returns false from isPlayerFastForwarding on external rate change', () => {
    const harness = createMobileControlsHarness();
    harness.art.playbackRate = 1.5;
    const onReset = jest.fn();
    const unsubscribe = subscribePlayerFastForwardReset(harness.art, onReset);

    const handle = enterPlayerFastForward(harness.art);
    expect(handle).not.toBeNull();
    expect(isPlayerFastForwarding(harness.art)).toBe(true);

    // 外部修改倍速偏离 3x 后，isPlayerFastForwarding 立即返回 false
    harness.art.playbackRate = 2;
    expect(isPlayerFastForwarding(harness.art)).toBe(false);

    restorePlayerPlaybackRate(harness.art, 1.5);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(harness.playbackRate).toBe(1.5);
    expect(isPlayerFastForwarding(harness.art)).toBe(false);

    unsubscribe();
    restorePlayerPlaybackRate(harness.art, 1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('updates $video playbackRate silently without triggering notice and skips destroyed players', () => {
    const playerElement = document.createElement('div');
    const video = document.createElement('video');
    const art = {
      constructor: { FAST_FORWARD_VALUE: 3 },
      isDestroy: false,
      template: { $player: playerElement, $video: video },
      notice: {
        show: '',
      },
      get playbackRate() {
        return video.playbackRate;
      },
      set playbackRate(value: number) {
        video.playbackRate = value;
        this.notice.show = `速度: ${value}x`;
      },
    };
    video.playbackRate = 1.25;

    const handle = enterPlayerFastForward(art, { silent: true });
    expect(handle).not.toBeNull();
    expect(video.playbackRate).toBe(3);
    expect(art.notice.show).toBe('');

    art.isDestroy = true;
    exitPlayerFastForward(art, handle!.previousPlaybackRate, { silent: true });
    expect(video.playbackRate).toBe(3);
    expect(art.notice.show).toBe('');
    expect(isPlayerFastForwarding(art)).toBe(false);
  });
});
