import { act, renderHook } from '@testing-library/react';
import type Artplayer from 'artplayer';
import type { MutableRefObject } from 'react';

import { usePlayerKeyboard } from '@/hooks/usePlayerKeyboard';
import { isPlayerFastForwarding } from '@/lib/player-runtime';
import { setPlayerShortcutsSuspended } from '@/lib/player-shortcuts';

function createPlayerHarness(
  options: {
    playbackRate?: number;
    playing?: boolean;
    fastForwardTime?: number;
    fastForwardValue?: number;
  } = {},
) {
  const playerElement = document.createElement('div');
  playerElement.className = 'art-video-player';
  const stateElement = document.createElement('div');
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  let loadingVisible = false;
  let playbackRate = options.playbackRate ?? 1;
  let noticeText = '';

  const emit = (name: string, ...args: unknown[]) => {
    for (const listener of (listeners.get(name) || []).slice()) {
      listener(...args);
    }
  };

  const notice = {
    get show() {
      return noticeText;
    },
    set show(value: string) {
      noticeText = value;
      if (value) {
        playerElement.classList.add('art-notice-show');
      } else {
        playerElement.classList.remove('art-notice-show');
      }
    },
  };

  const player = {
    constructor: {
      FAST_FORWARD_TIME: options.fastForwardTime ?? 1_000,
      FAST_FORWARD_VALUE: options.fastForwardValue ?? 3,
    },
    currentTime: 50,
    duration: 100,
    volume: 0.5,
    muted: false,
    get playbackRate() {
      return playbackRate;
    },
    set playbackRate(value: number) {
      if (value === playbackRate) return;
      playbackRate = value;
      notice.show = `倍速: ${value === 1 ? '正常' : `${value}x`}`;
      emit('video:ratechange');
    },
    fullscreen: false,
    playing: options.playing ?? true,
    isDestroy: false,
    notice,
    template: { $player: playerElement, $state: stateElement },
    loading: {
      get show() {
        return loadingVisible;
      },
      set show(value: boolean) {
        loadingVisible = value;
        emit('loading', value);
      },
    },
    on: jest.fn((name: string, fn: (...args: unknown[]) => void) => {
      listeners.set(name, [...(listeners.get(name) || []), fn]);
    }),
    off: jest.fn((name: string, fn: (...args: unknown[]) => void) => {
      listeners.set(
        name,
        (listeners.get(name) || []).filter((item) => item !== fn),
      );
    }),
    toggle: jest.fn(),
    pause: jest.fn(),
    once: jest.fn(),
  } as unknown as Artplayer;
  const artPlayerRef = {
    current: player,
  } as MutableRefObject<Artplayer | null>;

  return { artPlayerRef, player, playerElement, emit };
}

function dispatchShortcut(
  key: string,
  modifiers: Pick<
    KeyboardEventInit,
    'altKey' | 'ctrlKey' | 'shiftKey' | 'repeat'
  > = {},
) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => document.dispatchEvent(event));
  return event;
}

function dispatchKeyUp(
  key: string,
  modifiers: Pick<KeyboardEventInit, 'altKey' | 'ctrlKey' | 'shiftKey'> = {},
) {
  const event = new KeyboardEvent('keyup', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => document.dispatchEvent(event));
  return event;
}

describe('usePlayerKeyboard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setPlayerShortcutsSuspended(false);
  });

  it('ignores timeline and playback-rate shortcuts in live mode', () => {
    const { artPlayerRef, player } = createPlayerHarness();
    renderHook(() => usePlayerKeyboard({ artPlayerRef, mode: 'live' }));

    const seekEvent = dispatchShortcut('ArrowRight');
    const rateEvent = dispatchShortcut('c');
    const frameEvent = dispatchShortcut('f');
    const episodeEvent = dispatchShortcut('ArrowRight', { altKey: true });

    expect(player.currentTime).toBe(50);
    expect(player.playbackRate).toBe(1);
    expect(seekEvent.defaultPrevented).toBe(false);
    expect(rateEvent.defaultPrevented).toBe(false);
    expect(frameEvent.defaultPrevented).toBe(false);
    expect(episodeEvent.defaultPrevented).toBe(false);
  });

  it('keeps live-safe shortcuts enabled', () => {
    const { artPlayerRef, player } = createPlayerHarness();
    renderHook(() => usePlayerKeyboard({ artPlayerRef, mode: 'live' }));

    const playEvent = dispatchShortcut(' ');
    const volumeEvent = dispatchShortcut('ArrowUp');
    const fullscreenEvent = dispatchShortcut('Enter');

    expect(player.toggle).toHaveBeenCalledTimes(1);
    expect(player.volume).toBe(0.6);
    expect(player.fullscreen).toBe(true);
    expect(playEvent.defaultPrevented).toBe(true);
    expect(volumeEvent.defaultPrevented).toBe(true);
    expect(fullscreenEvent.defaultPrevented).toBe(true);
  });

  it('keeps the default VOD timeline shortcuts unchanged on short press', () => {
    const { artPlayerRef, player } = createPlayerHarness();
    renderHook(() => usePlayerKeyboard({ artPlayerRef }));

    const event = dispatchShortcut('ArrowRight');
    expect(event.defaultPrevented).toBe(true);
    expect(player.currentTime).toBe(50);

    dispatchKeyUp('ArrowRight');
    expect(player.currentTime).toBe(55);
    expect(player.notice.show).toBe('快进 5 秒');
  });

  it('lets a keyboard-focused button handle Enter and Space', () => {
    const { artPlayerRef, player } = createPlayerHarness();
    renderHook(() => usePlayerKeyboard({ artPlayerRef }));
    const button = document.createElement('button');
    document.body.appendChild(button);
    const matches = jest
      .spyOn(button, 'matches')
      .mockImplementation((selector) => selector === ':focus-visible');

    const dispatchOnButton = (key: string) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      act(() => button.dispatchEvent(event));
      return event;
    };

    const enter = dispatchOnButton('Enter');
    const space = dispatchOnButton(' ');
    const arrow = dispatchOnButton('ArrowRight');

    expect(enter.defaultPrevented).toBe(false);
    expect(space.defaultPrevented).toBe(false);
    expect(player.fullscreen).toBe(false);
    expect(player.toggle).not.toHaveBeenCalled();
    expect(arrow.defaultPrevented).toBe(true);

    // 鼠标点过的按钮不匹配 :focus-visible，空格仍控制播放
    matches.mockReturnValue(false);
    dispatchOnButton(' ');
    expect(player.toggle).toHaveBeenCalledTimes(1);
    button.remove();
  });

  it('toggles mute with M in both modes', () => {
    const { artPlayerRef, player } = createPlayerHarness();
    renderHook(() => usePlayerKeyboard({ artPlayerRef, mode: 'live' }));

    dispatchShortcut('m');
    expect(player.muted).toBe(true);
    dispatchShortcut('M');
    expect(player.muted).toBe(false);
  });

  it('keeps an older action that the user already bound to M', () => {
    window.localStorage.setItem(
      'playerShortcuts',
      JSON.stringify({ frameForward: { key: 'm' } }),
    );
    const { artPlayerRef, player } = createPlayerHarness();
    renderHook(() => usePlayerKeyboard({ artPlayerRef }));

    dispatchShortcut('m');

    expect(player.muted).toBe(false);
    expect(player.pause).toHaveBeenCalled();
  });

  it('keeps the loading spinner hidden while stepping frames', () => {
    const { artPlayerRef, player } = createPlayerHarness();
    renderHook(() => usePlayerKeyboard({ artPlayerRef }));

    dispatchShortcut('f');
    act(() => {
      player.loading.show = true;
    });

    expect(player.loading.show).toBe(false);
  });

  it('stops suppressing the loading spinner after the frame-step window', () => {
    jest.useFakeTimers();
    try {
      const { artPlayerRef, player } = createPlayerHarness();
      renderHook(() => usePlayerKeyboard({ artPlayerRef }));

      dispatchShortcut('f');
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      act(() => {
        player.loading.show = true;
      });

      expect(player.loading.show).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('long-press seekForward fast-forward', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it('seeks forward once on short press and ignores keydown repeats', () => {
      const { artPlayerRef, player, playerElement } = createPlayerHarness();
      renderHook(() => usePlayerKeyboard({ artPlayerRef }));

      const down = dispatchShortcut('ArrowRight');
      const repeat1 = dispatchShortcut('ArrowRight', { repeat: true });
      act(() => {
        jest.advanceTimersByTime(500);
      });
      const repeat2 = dispatchShortcut('ArrowRight', { repeat: true });
      dispatchKeyUp('ArrowRight');

      expect(down.defaultPrevented).toBe(true);
      expect(repeat1.defaultPrevented).toBe(true);
      expect(repeat2.defaultPrevented).toBe(true);
      expect(player.currentTime).toBe(55);
      expect(player.playbackRate).toBe(1);
      expect(player.notice.show).toBe('快进 5 秒');
      expect(
        playerElement.querySelector('.ice-fast-forward-notice'),
      ).toBeNull();
    });

    it('enters 3x fast-forward with persistent notice and restores original rate on release', () => {
      const { artPlayerRef, player, playerElement } = createPlayerHarness({
        playbackRate: 1.5,
      });
      renderHook(() => usePlayerKeyboard({ artPlayerRef }));

      dispatchShortcut('ArrowRight');
      act(() => {
        jest.advanceTimersByTime(999);
      });
      expect(player.playbackRate).toBe(1.5);
      expect(isPlayerFastForwarding(player)).toBe(false);

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(player.playbackRate).toBe(3);
      expect(isPlayerFastForwarding(player)).toBe(true);
      expect(playerElement.classList.contains('art-fast-forward')).toBe(true);
      expect(playerElement.classList.contains('art-notice-show')).toBe(false);

      const notice = playerElement.querySelector('.ice-fast-forward-notice');
      expect(notice).not.toBeNull();
      expect(notice?.querySelector('svg')).not.toBeNull();
      expect(notice?.textContent).toBe('3倍速中');

      // 超过默认 notice 时长仍保持常驻；期间其他提示可覆盖并恢复
      act(() => {
        jest.advanceTimersByTime(5_000);
      });
      expect(
        playerElement.querySelector('.ice-fast-forward-notice'),
      ).not.toBeNull();

      dispatchShortcut('ArrowUp');
      expect(player.notice.show).toBe('音量: 60');
      expect(playerElement.classList.contains('art-notice-show')).toBe(true);
      expect(
        playerElement.querySelector('.ice-fast-forward-notice'),
      ).not.toBeNull();

      act(() => {
        player.notice.show = '';
      });
      expect(playerElement.classList.contains('art-notice-show')).toBe(false);
      expect(
        playerElement.querySelector('.ice-fast-forward-notice'),
      ).not.toBeNull();

      dispatchKeyUp('ArrowRight');
      expect(player.playbackRate).toBe(1.5);
      expect(player.currentTime).toBe(50);
      expect(isPlayerFastForwarding(player)).toBe(false);
      expect(playerElement.classList.contains('art-fast-forward')).toBe(false);
      expect(playerElement.classList.contains('art-notice-show')).toBe(false);
      expect(
        playerElement.querySelector('.ice-fast-forward-notice'),
      ).toBeNull();
    });

    it('restores default 1x playback rate after long-press fast-forward', () => {
      const { artPlayerRef, player } = createPlayerHarness({ playbackRate: 1 });
      renderHook(() => usePlayerKeyboard({ artPlayerRef }));

      dispatchShortcut('ArrowRight');
      act(() => {
        jest.advanceTimersByTime(1_000);
      });
      expect(player.playbackRate).toBe(3);

      dispatchKeyUp('ArrowRight');
      expect(player.playbackRate).toBe(1);
      expect(player.currentTime).toBe(50);
    });

    it('treats long press while paused as a single short press on release', () => {
      const { artPlayerRef, player, playerElement } = createPlayerHarness({
        playing: false,
      });
      renderHook(() => usePlayerKeyboard({ artPlayerRef }));

      dispatchShortcut('ArrowRight');
      act(() => {
        jest.advanceTimersByTime(1_500);
      });
      dispatchShortcut('ArrowRight', { repeat: true });

      expect(player.playbackRate).toBe(1);
      expect(isPlayerFastForwarding(player)).toBe(false);
      expect(
        playerElement.querySelector('.ice-fast-forward-notice'),
      ).toBeNull();

      dispatchKeyUp('ArrowRight');
      expect(player.currentTime).toBe(55);
      expect(player.notice.show).toBe('快进 5 秒');
    });

    it('does not persist 3x playback rate preference during fast-forward', () => {
      const { artPlayerRef, player } = createPlayerHarness({
        playbackRate: 1.25,
      });
      const persistedRates: number[] = [];
      player.on('video:ratechange', () => {
        if (isPlayerFastForwarding(player)) return;
        persistedRates.push(player.playbackRate as number);
      });
      renderHook(() => usePlayerKeyboard({ artPlayerRef }));

      dispatchShortcut('ArrowRight');
      act(() => {
        jest.advanceTimersByTime(1_000);
      });
      expect(player.playbackRate).toBe(3);
      expect(persistedRates).toEqual([]);

      dispatchKeyUp('ArrowRight');
      expect(player.playbackRate).toBe(1.25);
      expect(persistedRates).toEqual([1.25]);
    });

    it('respects custom seekForward shortcut binding', () => {
      window.localStorage.setItem(
        'playerShortcuts',
        JSON.stringify({ seekForward: { key: 'l', ctrlKey: true } }),
      );
      const { artPlayerRef, player, playerElement } = createPlayerHarness();
      renderHook(() => usePlayerKeyboard({ artPlayerRef }));

      dispatchShortcut('l', { ctrlKey: true });
      act(() => {
        jest.advanceTimersByTime(1_000);
      });
      expect(player.playbackRate).toBe(3);
      expect(
        playerElement.querySelector('.ice-fast-forward-notice'),
      ).not.toBeNull();

      dispatchKeyUp('L', { ctrlKey: true });
      expect(player.playbackRate).toBe(1);
      expect(
        playerElement.querySelector('.ice-fast-forward-notice'),
      ).toBeNull();
    });

    it('exits fast-forward immediately on window blur', () => {
      const { artPlayerRef, player, playerElement } = createPlayerHarness({
        playbackRate: 1.5,
      });
      renderHook(() => usePlayerKeyboard({ artPlayerRef }));

      dispatchShortcut('ArrowRight');
      act(() => {
        jest.advanceTimersByTime(1_000);
      });
      expect(player.playbackRate).toBe(3);

      act(() => {
        window.dispatchEvent(new Event('blur'));
      });
      expect(player.playbackRate).toBe(1.5);
      expect(isPlayerFastForwarding(player)).toBe(false);
      expect(
        playerElement.querySelector('.ice-fast-forward-notice'),
      ).toBeNull();

      // 失焦取消后迟到的 keyup 不再补快进
      dispatchKeyUp('ArrowRight');
      expect(player.currentTime).toBe(50);
    });

    it('exits fast-forward on visibility hidden, player destroy, suspension, and unmount', () => {
      const runCase = (
        trigger: () => void,
        harness: ReturnType<typeof createPlayerHarness>,
      ) => {
        dispatchShortcut('ArrowRight');
        act(() => {
          jest.advanceTimersByTime(1_000);
        });
        expect(harness.player.playbackRate).toBe(3);
        expect(
          harness.playerElement.querySelector('.ice-fast-forward-notice'),
        ).not.toBeNull();

        act(() => {
          trigger();
        });
        expect(harness.player.playbackRate).toBe(1.25);
        expect(isPlayerFastForwarding(harness.player)).toBe(false);
        expect(
          harness.playerElement.querySelector('.ice-fast-forward-notice'),
        ).toBeNull();
      };

      const hiddenHarness = createPlayerHarness({ playbackRate: 1.25 });
      const { unmount: unmountHidden } = renderHook(() =>
        usePlayerKeyboard({ artPlayerRef: hiddenHarness.artPlayerRef }),
      );
      let isDocumentHidden = false;
      const hiddenSpy = jest
        .spyOn(document, 'hidden', 'get')
        .mockImplementation(() => isDocumentHidden);
      runCase(() => {
        isDocumentHidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
      }, hiddenHarness);
      hiddenSpy.mockRestore();
      unmountHidden();

      const destroyHarness = createPlayerHarness({ playbackRate: 1.25 });
      const { unmount: unmountDestroy } = renderHook(() =>
        usePlayerKeyboard({ artPlayerRef: destroyHarness.artPlayerRef }),
      );
      runCase(() => {
        destroyHarness.emit('destroy');
      }, destroyHarness);
      unmountDestroy();

      const suspendHarness = createPlayerHarness({ playbackRate: 1.25 });
      const { unmount: unmountSuspend } = renderHook(() =>
        usePlayerKeyboard({ artPlayerRef: suspendHarness.artPlayerRef }),
      );
      runCase(() => {
        setPlayerShortcutsSuspended(true);
      }, suspendHarness);
      setPlayerShortcutsSuspended(false);
      unmountSuspend();

      const unmountHarness = createPlayerHarness({ playbackRate: 1.25 });
      const { unmount } = renderHook(() =>
        usePlayerKeyboard({ artPlayerRef: unmountHarness.artPlayerRef }),
      );
      runCase(() => {
        unmount();
      }, unmountHarness);

      const swapHarness = createPlayerHarness({ playbackRate: 1.25 });
      const nextHarness = createPlayerHarness({ playbackRate: 1 });
      const { unmount: unmountSwap } = renderHook(() =>
        usePlayerKeyboard({ artPlayerRef: swapHarness.artPlayerRef }),
      );
      runCase(() => {
        swapHarness.artPlayerRef.current = nextHarness.player;
        dispatchKeyUp('ArrowRight');
      }, swapHarness);
      expect(nextHarness.player.currentTime).toBe(50);
      unmountSwap();
    });

    it('converts fast-forward notice label via display-text converter', () => {
      const globals = globalThis as {
        __ICETV_DISPLAY_CONVERTER__?: (text: string) => string;
      };
      const prevLang = document.documentElement.lang;
      const prevConverter = globals.__ICETV_DISPLAY_CONVERTER__;
      document.documentElement.lang = 'zh-TW';
      globals.__ICETV_DISPLAY_CONVERTER__ = (text) =>
        text.replace('倍速中', '倍速播放中');

      try {
        const { artPlayerRef, playerElement } = createPlayerHarness();
        renderHook(() => usePlayerKeyboard({ artPlayerRef }));

        dispatchShortcut('ArrowRight');
        act(() => {
          jest.advanceTimersByTime(1_000);
        });
        expect(
          playerElement.querySelector('.ice-fast-forward-notice')?.textContent,
        ).toBe('3倍速播放中');
      } finally {
        document.documentElement.lang = prevLang;
        globals.__ICETV_DISPLAY_CONVERTER__ = prevConverter;
      }
    });

    it('keeps long-press fast-forward alive across rerenders with new episodeHandlers and uses latest episode handlers', () => {
      const { artPlayerRef, player, playerElement } = createPlayerHarness({
        playbackRate: 1.5,
      });
      const detailRef = {
        current: { episodes: ['ep1', 'ep2', 'ep3'] },
      };
      const currentEpisodeIndexRef = { current: 1 };
      const firstPrev = jest.fn();
      const firstNext = jest.fn();
      const latestPrev = jest.fn();
      const latestNext = jest.fn();

      const { rerender } = renderHook(
        ({
          handlePreviousEpisode,
          handleNextEpisode,
        }: {
          handlePreviousEpisode: () => void;
          handleNextEpisode: () => void;
        }) =>
          usePlayerKeyboard({
            artPlayerRef,
            episodeHandlers: {
              detailRef,
              currentEpisodeIndexRef,
              handlePreviousEpisode,
              handleNextEpisode,
            },
          }),
        {
          initialProps: {
            handlePreviousEpisode: firstPrev,
            handleNextEpisode: firstNext,
          },
        },
      );

      dispatchShortcut('ArrowRight');
      act(() => {
        jest.advanceTimersByTime(400);
      });

      // 长按计时期间父组件重渲染并传入新的 episodeHandlers 对象
      rerender({
        handlePreviousEpisode: latestPrev,
        handleNextEpisode: latestNext,
      });

      act(() => {
        jest.advanceTimersByTime(600);
      });
      expect(player.playbackRate).toBe(3);
      expect(isPlayerFastForwarding(player)).toBe(true);
      expect(
        playerElement.querySelector('.ice-fast-forward-notice'),
      ).not.toBeNull();

      // 倍速期间再次重渲染也不应中断倍速
      rerender({
        handlePreviousEpisode: latestPrev,
        handleNextEpisode: latestNext,
      });
      expect(player.playbackRate).toBe(3);
      expect(
        playerElement.querySelector('.ice-fast-forward-notice'),
      ).not.toBeNull();

      dispatchKeyUp('ArrowRight');
      expect(player.playbackRate).toBe(1.5);
      expect(player.currentTime).toBe(50);
      expect(
        playerElement.querySelector('.ice-fast-forward-notice'),
      ).toBeNull();

      // 重渲染后切集快捷键调用的是最新 handler
      dispatchShortcut('ArrowLeft', { altKey: true });
      dispatchShortcut('ArrowRight', { altKey: true });
      expect(firstPrev).not.toHaveBeenCalled();
      expect(firstNext).not.toHaveBeenCalled();
      expect(latestPrev).toHaveBeenCalledTimes(1);
      expect(latestNext).toHaveBeenCalledTimes(1);
    });
  });
});
