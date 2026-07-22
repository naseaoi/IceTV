import { act, renderHook } from '@testing-library/react';
import type Artplayer from 'artplayer';
import type { MutableRefObject } from 'react';

import { usePlayerKeyboard } from '@/hooks/usePlayerKeyboard';
import { setPlayerShortcutsSuspended } from '@/lib/player-shortcuts';

function createPlayerHarness() {
  const stateElement = document.createElement('div');
  const player = {
    currentTime: 50,
    duration: 100,
    volume: 0.5,
    playbackRate: 1,
    fullscreen: false,
    playing: true,
    notice: { show: '' },
    template: { $state: stateElement },
    toggle: jest.fn(),
    pause: jest.fn(),
    once: jest.fn(),
  } as unknown as Artplayer;
  const artPlayerRef = {
    current: player,
  } as MutableRefObject<Artplayer | null>;

  return { artPlayerRef, player };
}

function dispatchShortcut(
  key: string,
  modifiers: Pick<KeyboardEventInit, 'altKey' | 'ctrlKey' | 'shiftKey'> = {},
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

  it('keeps the default VOD timeline shortcuts unchanged', () => {
    const { artPlayerRef, player } = createPlayerHarness();
    renderHook(() => usePlayerKeyboard({ artPlayerRef }));

    const event = dispatchShortcut('ArrowRight');

    expect(player.currentTime).toBe(55);
    expect(event.defaultPrevented).toBe(true);
  });
});
