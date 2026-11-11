import {
  bindPlayerHoverControls,
  bindPlayerMobileControls,
  createHlsLoaderClass,
  isPlayerFastForwarding,
  prefetchM3U8,
  restorePlayerPlaybackRate,
} from '@/lib/player-runtime';

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
      expect(fetchMock).toHaveBeenCalledWith(url, { cache: 'no-store' });
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

function createHoverControlsHarness({ mobile = false } = {}) {
  const player = document.createElement('div');
  if (mobile) {
    player.classList.add('art-mobile');
  }
  document.body.appendChild(player);

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
});
