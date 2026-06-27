import { bindPlayerHoverControls } from '@/lib/player-runtime';

type Listener = (...args: unknown[]) => void;

function createHoverControlsHarness() {
  const player = document.createElement('div');
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
});
