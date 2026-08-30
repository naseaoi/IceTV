import type Artplayer from 'artplayer';
import { MutableRefObject, useEffect } from 'react';

import {
  type PlayerShortcutAction,
  type PlayerShortcutMap,
  type PlayerShortcutMode,
  arePlayerShortcutsSuspended,
  FRAME_STEP_SECONDS,
  isPlayerShortcutActionEnabled,
  PLAYER_SHORTCUTS_CHANGED_EVENT,
  RATE_MAX,
  RATE_MIN,
  RATE_STEP,
  readPlayerShortcuts,
  resolveShortcutAction,
  SEEK_STEP_LONG_SECONDS,
  SEEK_STEP_SECONDS,
  VOLUME_STEP,
} from '@/lib/player-shortcuts';

interface EpisodeHandlers {
  detailRef: MutableRefObject<{ episodes: unknown[] } | null>;
  currentEpisodeIndexRef: MutableRefObject<number>;
  handlePreviousEpisode: () => void;
  handleNextEpisode: () => void;
}

interface UsePlayerKeyboardParams {
  artPlayerRef: MutableRefObject<Artplayer | null>;
  episodeHandlers?: EpisodeHandlers;
  mode?: PlayerShortcutMode;
}

const FRAME_STEP_LOADING_GUARD_MS = 600;

function clampRate(rate: number): number {
  const rounded = Math.round(rate * 10) / 10;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, rounded));
}

export function usePlayerKeyboard({
  artPlayerRef,
  episodeHandlers,
  mode = 'vod',
}: UsePlayerKeyboardParams) {
  useEffect(() => {
    let shortcuts: PlayerShortcutMap = readPlayerShortcuts();
    let frameStepLoadingTimer: number | null = null;
    let frameStepLoadingGuard: {
      player: Artplayer;
      handler: (visible: boolean) => void;
    } | null = null;

    const releaseLoadingSpinnerGuard = () => {
      if (frameStepLoadingTimer !== null) {
        window.clearTimeout(frameStepLoadingTimer);
        frameStepLoadingTimer = null;
      }
      if (!frameStepLoadingGuard) return;
      const { player, handler } = frameStepLoadingGuard;
      frameStepLoadingGuard = null;
      (
        player as unknown as {
          off: (name: string, fn: (visible: boolean) => void) => void;
        }
      ).off('loading', handler);
    };

    const syncShortcuts = () => {
      shortcuts = readPlayerShortcuts();
    };
    window.addEventListener(PLAYER_SHORTCUTS_CHANGED_EVENT, syncShortcuts);

    const seekBy = (seconds: number) => {
      const player = artPlayerRef.current;
      if (!player) return;
      const duration = player.duration || 0;
      const next = Math.min(
        Math.max(0, player.currentTime + seconds),
        duration > 0 ? duration : player.currentTime + seconds,
      );
      player.currentTime = next;
      const arrow = seconds > 0 ? '快进' : '快退';
      player.notice.show = `${arrow} ${Math.abs(seconds)} 秒`;
    };

    const changeVolume = (delta: number) => {
      const player = artPlayerRef.current;
      if (!player) return;
      const next = Math.round((player.volume + delta) * 10) / 10;
      player.volume = Math.min(1, Math.max(0, next));
      player.notice.show = `音量: ${Math.round(player.volume * 100)}`;
    };

    const changeRate = (delta: number) => {
      const player = artPlayerRef.current;
      if (!player) return;
      const next = clampRate((player.playbackRate as number) + delta);
      player.playbackRate = next;
      player.notice.show = `倍速: ${next.toFixed(1)}x`;
    };

    const resetRate = () => {
      const player = artPlayerRef.current;
      if (!player) return;
      player.playbackRate = 1;
      player.notice.show = '倍速: 1.0x';
    };

    const hidePauseStateIcon = (player: Artplayer) => {
      const stateEl = (player.template as unknown as { $state?: HTMLElement })
        .$state;
      if (!stateEl || stateEl.style.display === 'none') return;
      stateEl.style.display = 'none';
      player.once('play', () => {
        stateEl.style.display = '';
      });
    };

    const suppressLoadingSpinner = (player: Artplayer) => {
      if (frameStepLoadingGuard && frameStepLoadingGuard.player !== player) {
        releaseLoadingSpinnerGuard();
      }
      if (frameStepLoadingTimer !== null) {
        window.clearTimeout(frameStepLoadingTimer);
        frameStepLoadingTimer = null;
      }
      if (!frameStepLoadingGuard) {
        frameStepLoadingGuard = {
          player,
          handler: (visible: boolean) => {
            if (visible) {
              player.loading.show = false;
            }
          },
        };
        player.on('loading', frameStepLoadingGuard.handler);
      }
      player.loading.show = false;
      frameStepLoadingTimer = window.setTimeout(
        releaseLoadingSpinnerGuard,
        FRAME_STEP_LOADING_GUARD_MS,
      );
    };

    const stepFrame = (direction: 1 | -1) => {
      const player = artPlayerRef.current;
      if (!player) return;
      if (player.playing) {
        player.pause();
      }
      hidePauseStateIcon(player);
      suppressLoadingSpinner(player);
      player.notice.show = '';
      const duration = player.duration || 0;
      const next = player.currentTime + direction * FRAME_STEP_SECONDS;
      player.currentTime = Math.min(
        Math.max(0, next),
        duration > 0 ? duration : next,
      );
    };

    const toggleFullscreen = () => {
      const player = artPlayerRef.current;
      if (!player) return;
      player.fullscreen = !player.fullscreen;
    };

    const switchEpisode = (direction: 1 | -1): boolean => {
      if (!episodeHandlers) return false;
      const detail = episodeHandlers.detailRef.current;
      const index = episodeHandlers.currentEpisodeIndexRef.current;
      if (direction < 0) {
        if (detail && index > 0) {
          episodeHandlers.handlePreviousEpisode();
          return true;
        }
        return false;
      }
      if (detail && index < detail.episodes.length - 1) {
        episodeHandlers.handleNextEpisode();
        return true;
      }
      return false;
    };

    const actionHandlers: Record<PlayerShortcutAction, () => void> = {
      playPause: () => artPlayerRef.current?.toggle(),
      seekBackward: () => seekBy(-SEEK_STEP_SECONDS),
      seekForward: () => seekBy(SEEK_STEP_SECONDS),
      seekBackwardLong: () => seekBy(-SEEK_STEP_LONG_SECONDS),
      seekForwardLong: () => seekBy(SEEK_STEP_LONG_SECONDS),
      volumeUp: () => changeVolume(VOLUME_STEP),
      volumeDown: () => changeVolume(-VOLUME_STEP),
      fullscreen: toggleFullscreen,
      resetRate,
      decreaseRate: () => changeRate(-RATE_STEP),
      increaseRate: () => changeRate(RATE_STEP),
      frameBackward: () => stepFrame(-1),
      frameForward: () => stepFrame(1),
      prevEpisode: () => switchEpisode(-1),
      nextEpisode: () => switchEpisode(1),
    };

    const isEpisodeAction = (action: PlayerShortcutAction) =>
      action === 'prevEpisode' || action === 'nextEpisode';

    const handleKeyboardShortcuts = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (arePlayerShortcutsSuspended()) {
        return;
      }

      const action = resolveShortcutAction(e, shortcuts);
      if (!action) return;

      if (!isPlayerShortcutActionEnabled(mode, action)) {
        return;
      }

      if (isEpisodeAction(action) && !episodeHandlers) {
        return;
      }

      if (!artPlayerRef.current) return;

      e.preventDefault();
      actionHandlers[action]();
    };

    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
      window.removeEventListener(PLAYER_SHORTCUTS_CHANGED_EVENT, syncShortcuts);
      releaseLoadingSpinnerGuard();
    };
  }, [artPlayerRef, episodeHandlers, mode]);
}
