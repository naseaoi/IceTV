import {
  bindPlayerHoverControls,
  bindPlayerMobileControls,
  isPlayerFastForwarding,
  restorePlayerPlaybackRate,
} from '@/lib/player-runtime';

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
